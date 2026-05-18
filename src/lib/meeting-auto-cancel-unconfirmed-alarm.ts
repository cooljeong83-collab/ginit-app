import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

const STORAGE_PREFIX = 'ginit:meetingAutoCancelUnconfirmedAlarms:v1:';

export const MEETING_AUTO_CANCEL_UNCONFIRMED_ALARM_SUBTITLE =
  '모임이 확정되지 않아 자동 파기 됐습니다.';

export type MeetingAutoCancelUnconfirmedAlarm = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  subtitle: string;
  sortMs: number;
};

type StoredShape = {
  schema?: number;
  pending?: MeetingAutoCancelUnconfirmedAlarm[];
  dismissedIds?: Record<string, true>;
};

const listeners = new Set<() => void>();

function storageKey(userId: string): string {
  const canon = normalizeParticipantId(userId.trim()) || userId.trim();
  return `${STORAGE_PREFIX}${canon}`;
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function meetingAutoCancelUnconfirmedAlarmId(meetingId: string): string {
  return `auto_cancel:${meetingId.trim()}`;
}

export function subscribeMeetingAutoCancelUnconfirmedAlarms(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

async function readStore(userId: string): Promise<Required<StoredShape>> {
  const uid = userId.trim();
  if (!uid) {
    return { schema: 1, pending: [], dismissedIds: {} };
  }
  try {
    const raw = await AsyncStorage.getItem(storageKey(uid));
    if (!raw?.trim()) return { schema: 1, pending: [], dismissedIds: {} };
    const parsed = JSON.parse(raw) as StoredShape;
    return {
      schema: 1,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      dismissedIds:
        parsed.dismissedIds && typeof parsed.dismissedIds === 'object' ? parsed.dismissedIds : {},
    };
  } catch (e) {
    ginitNotifyDbg('meeting-auto-cancel-alarm', 'load_error', {
      message: e instanceof Error ? e.message : String(e),
    });
    return { schema: 1, pending: [], dismissedIds: {} };
  }
}

async function writeStore(userId: string, store: Required<StoredShape>): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;
  try {
    await AsyncStorage.setItem(storageKey(uid), JSON.stringify(store));
  } catch (e) {
    ginitNotifyDbg('meeting-auto-cancel-alarm', 'save_error', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function loadMeetingAutoCancelUnconfirmedAlarms(
  userId: string,
): Promise<MeetingAutoCancelUnconfirmedAlarm[]> {
  const store = await readStore(userId);
  const dismissed = store.dismissedIds;
  return store.pending.filter((row) => {
    const id = row.id?.trim();
    return id && !dismissed[id];
  });
}

export async function appendMeetingAutoCancelUnconfirmedAlarm(params: {
  userId: string;
  meetingId: string;
  meetingTitle: string;
}): Promise<void> {
  const uid = params.userId.trim();
  const meetingId = params.meetingId.trim();
  if (!uid || !meetingId) return;

  const id = meetingAutoCancelUnconfirmedAlarmId(meetingId);
  const store = await readStore(uid);
  if (store.dismissedIds[id]) return;

  const title = params.meetingTitle.trim() || '모임';
  const row: MeetingAutoCancelUnconfirmedAlarm = {
    id,
    meetingId,
    meetingTitle: title,
    subtitle: MEETING_AUTO_CANCEL_UNCONFIRMED_ALARM_SUBTITLE,
    sortMs: Date.now(),
  };

  const nextPending = [row, ...store.pending.filter((p) => p.id !== id)].slice(0, 80);
  await writeStore(uid, { ...store, pending: nextPending });
  ginitNotifyDbg('meeting-auto-cancel-alarm', 'append', { meetingId, alarmId: id });
  notifyListeners();
}

export async function dismissMeetingAutoCancelUnconfirmedAlarm(
  userId: string,
  alarmId: string,
): Promise<void> {
  const uid = userId.trim();
  const id = alarmId.trim();
  if (!uid || !id) return;

  const store = await readStore(uid);
  if (store.dismissedIds[id]) return;

  await writeStore(uid, {
    ...store,
    dismissedIds: { ...store.dismissedIds, [id]: true },
    pending: store.pending.filter((p) => p.id !== id),
  });
  notifyListeners();
}

export async function dismissAllMeetingAutoCancelUnconfirmedAlarms(userId: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) return;

  const store = await readStore(uid);
  const dismissedIds = { ...store.dismissedIds };
  for (const row of store.pending) {
    if (row.id?.trim()) dismissedIds[row.id] = true;
  }
  await writeStore(uid, { ...store, pending: [], dismissedIds });
  notifyListeners();
}
