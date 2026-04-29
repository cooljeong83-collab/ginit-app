import notifee, { AndroidImportance } from '@notifee/react-native';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';

/** FCM·포그라운드 표시용 Notifee 채널 (Android) */
export const GINIT_FCM_NOTIFEE_CHANNEL = 'ginit_fcm';

export function fcmDataToStringRecord(data: FirebaseMessagingTypes.RemoteMessage['data']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

export async function ensureGinitFcmNotifeeChannel(): Promise<void> {
  await notifee.createChannel({
    id: GINIT_FCM_NOTIFEE_CHANNEL,
    name: '새 소식',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    // Notifee 요구사항: 양수만, 짝수 개(대기/진동 ms 쌍)
    vibrationPattern: [220, 220],
  });
}

function titleBodyFromRemoteMessage(rm: FirebaseMessagingTypes.RemoteMessage): { title: string; body: string } | null {
  const n = rm.notification;
  const t0 = (n?.title ?? '').trim();
  const b0 = (n?.body ?? '').trim();
  if (t0 || b0) {
    return { title: t0 || '새 알림', body: b0 || '새 소식이 도착했어요.' };
  }
  const d = rm.data ?? {};
  const title = String(d.title ?? d.meetingTitle ?? '').trim();
  const body = String(d.body ?? d.preview ?? d.text ?? '').trim();
  if (!title && !body) return null;
  return { title, body };
}

/** Android: FCM 수신(포그라운드·백그라운드 data-only 등) 시 시스템 알림과 동일하게 Notifee로 표시 */
export async function displayFcmRemoteMessageWithNotifeeAndroid(
  rm: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
  const content = titleBodyFromRemoteMessage(rm);
  if (!content) return;
  const { title, body } = content;
  const data = fcmDataToStringRecord(rm.data);
  await ensureGinitFcmNotifeeChannel();
  await notifee.displayNotification({
    title,
    body,
    data,
    android: {
      channelId: GINIT_FCM_NOTIFEE_CHANNEL,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
    },
  });
}
