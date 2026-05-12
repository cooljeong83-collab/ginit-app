import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidGroupAlertBehavior, AndroidImportance, AndroidStyle } from '@notifee/react-native';

import { getGinitFcmDisplayNotifeeChannelId } from '@/src/lib/profile-notification-sound-preference';

export const GINIT_APP_NOTIFICATION_GROUP_ID = 'ginit_app_notifications_v1';
export const GINIT_APP_NOTIFICATION_SUMMARY_ID = 'ginit_app_notifications_summary_v1';

const STORAGE_KEY = 'ginit.notifee_app_group.entries.v1';
const MAX_TRACKED_GROUP_NOTIFICATIONS = 64;

export type GinitGroupedNotificationEntry = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
  data?: Record<string, string>;
};

function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function ginitGroupedNotificationId(prefix: string, seed: string): string {
  const p = prefix.trim() || 'ginit';
  const s = seed.trim() || `${Date.now()}`;
  return `${p}_${stableHash(s)}`;
}

function normalizeEntry(raw: unknown): GinitGroupedNotificationEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<GinitGroupedNotificationEntry>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!id || id === GINIT_APP_NOTIFICATION_SUMMARY_ID) return null;
  return {
    id,
    title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : '지닛',
    body: typeof r.body === 'string' && r.body.trim() ? r.body.trim() : '새 알림이 도착했어요.',
    updatedAt: Number.isFinite(Number(r.updatedAt)) ? Number(r.updatedAt) : Date.now(),
    data: r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : undefined,
  };
}

async function readEntries(): Promise<GinitGroupedNotificationEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((x): x is GinitGroupedNotificationEntry => Boolean(x));
  } catch {
    return [];
  }
}

async function writeEntries(entries: readonly GinitGroupedNotificationEntry[]): Promise<void> {
  const next = entries
    .map(normalizeEntry)
    .filter((x): x is GinitGroupedNotificationEntry => Boolean(x))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_TRACKED_GROUP_NOTIFICATIONS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

async function resolveChannelId(channelId?: string): Promise<string> {
  const explicit = channelId?.trim();
  if (explicit) return explicit;
  return getGinitFcmDisplayNotifeeChannelId().catch(() => 'ginit_fcm');
}

async function displaySummary(entries: readonly GinitGroupedNotificationEntry[], channelId?: string): Promise<void> {
  const latest = entries[0];
  const count = entries.length;
  if (!latest || count <= 1) {
    await notifee.cancelNotification(GINIT_APP_NOTIFICATION_SUMMARY_ID);
    return;
  }
  const resolvedChannelId = await resolveChannelId(channelId);
  await notifee.displayNotification({
    id: GINIT_APP_NOTIFICATION_SUMMARY_ID,
    title: latest.title,
    body: latest.body,
    data: latest.data,
    android: {
      channelId: resolvedChannelId,
      importance: AndroidImportance.HIGH,
      smallIcon: 'notification_icon',
      pressAction: { id: 'default' },
      groupId: GINIT_APP_NOTIFICATION_GROUP_ID,
      groupSummary: true,
      groupAlertBehavior: AndroidGroupAlertBehavior.CHILDREN,
      badgeCount: count,
      showTimestamp: true,
      timestamp: latest.updatedAt,
      style: {
        type: AndroidStyle.BIGTEXT,
        text: latest.body,
      },
    } as never,
  });
}

export async function registerGinitGroupedNotification(
  entry: GinitGroupedNotificationEntry,
  channelId?: string,
): Promise<number> {
  const normalized = normalizeEntry(entry);
  if (!normalized) return 0;
  const prev = await readEntries();
  const next = [normalized, ...prev.filter((x) => x.id !== normalized.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_TRACKED_GROUP_NOTIFICATIONS);
  await writeEntries(next);
  await displaySummary(next, channelId);
  return next.length;
}

export async function unregisterGinitGroupedNotifications(ids: readonly string[], channelId?: string): Promise<number> {
  const removeIds = new Set(ids.map((x) => x.trim()).filter(Boolean));
  if (removeIds.size === 0) return (await readEntries()).length;
  const next = (await readEntries()).filter((x) => !removeIds.has(x.id));
  await writeEntries(next);
  await displaySummary(next, channelId);
  return next.length;
}
