import notifee, { AndroidImportance } from '@notifee/react-native';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import { isProfileFcmQuietHoursActive } from '@/src/lib/profile-settings-local';
import { isSocialChatNotifyEnabled } from '@/src/lib/social-chat-notify-preference';

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
  if (await isProfileFcmQuietHoursActive()) {
    ginitNotifyDbg('fcm-notifee-display', 'skip_quiet_hours', { messageId: rm.messageId });
    return;
  }
  const content = titleBodyFromRemoteMessage(rm);
  if (!content) {
    ginitNotifyDbg('fcm-notifee-display', 'skip_no_content', { messageId: rm.messageId });
    return;
  }
  const { title, body } = content;
  const data = fcmDataToStringRecord(rm.data);
  const action = (data.action ?? '').trim();
  const meetingId = (data.meetingId ?? '').trim();
  if (action === 'in_app_chat' && meetingId) {
    const notifyOn = await isMeetingChatNotifyEnabled(meetingId);
    if (!notifyOn) {
      ginitNotifyDbg('fcm-notifee-display', 'skip_meeting_notify_off', { meetingId });
      return;
    }
  }
  if (action === 'in_app_social_dm' && meetingId) {
    const notifyOn = await isSocialChatNotifyEnabled(meetingId);
    if (!notifyOn) {
      ginitNotifyDbg('fcm-notifee-display', 'skip_social_notify_off', { meetingId });
      return;
    }
  }
  ginitNotifyDbg('fcm-notifee-display', 'display', {
    messageId: rm.messageId,
    action: action || undefined,
    meetingId: meetingId || undefined,
  });
  await ensureGinitFcmNotifeeChannel();
  await notifee.displayNotification({
    title,
    body,
    data,
    android: {
      channelId: GINIT_FCM_NOTIFEE_CHANNEL,
      importance: AndroidImportance.HIGH,
      smallIcon: 'notification_icon',
      pressAction: { id: 'default' },
    },
  });
}
