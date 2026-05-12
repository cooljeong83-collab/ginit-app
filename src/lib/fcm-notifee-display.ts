import notifee, { AndroidImportance, AndroidStyle } from '@notifee/react-native';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import {
  CHAT_PUSH_ACTION_MARK_READ,
  CHAT_PUSH_ACTION_REPLY,
  parseChatPushDisplayData,
  upsertChatPushNotificationState,
  type ChatPushNotificationState,
} from '@/src/lib/chat-push-notification-state';
import { consumeNotifeeDisplayOnceGlobalSync } from '@/src/lib/fcm-foreground-message-dedupe';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { diagLogAfterEnsureFcmNotifeeChannels } from '@/src/lib/notification-sound-diag';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import {
  getGinitFcmDisplayNotifeeChannelId,
  loadProfileNotificationSoundId,
  notifeeAndroidRawBaseName,
} from '@/src/lib/profile-notification-sound-preference';
import { isProfileFcmQuietHoursActive } from '@/src/lib/profile-settings-local';
import { isSocialChatNotifyEnabled } from '@/src/lib/social-chat-notify-preference';

/** 레거시 FCM·서버 `channelId` 호환용 (항상 시스템 기본음) */
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
  const displayId = await getGinitFcmDisplayNotifeeChannelId();
  const pref = await loadProfileNotificationSoundId();
  const raw = notifeeAndroidRawBaseName(pref);
  await notifee.createChannel({
    id: displayId,
    name: '새 소식',
    importance: AndroidImportance.HIGH,
    sound: raw ?? 'default',
    vibrationPattern: [220, 220],
  });
  void diagLogAfterEnsureFcmNotifeeChannels();
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

async function displayChatPushNotificationAndroid(
  state: ChatPushNotificationState,
  data: Record<string, string>,
  channelId: string,
): Promise<void> {
  const latestMessage = state.messages[0];
  const latestText = latestMessage?.text ?? '새 메시지';
  const senderLargeIcon =
    (state.roomType === 'social_dm' || state.roomType === 'meeting') && latestMessage?.senderPhotoUrl?.trim()
      ? latestMessage.senderPhotoUrl.trim()
      : undefined;
  const collapsedBody =
    state.roomType === 'meeting' && latestMessage?.senderName
      ? `${latestMessage.senderName} : ${latestText}`
      : latestText;
  const expandedText = state.roomType === 'meeting' ? collapsedBody : latestText;
  const notificationData = {
    ...data,
    roomType: state.roomType,
    roomId: state.roomId,
    meetingId: state.roomId,
    recipientUserId: state.recipientUserId,
    lastMessageId: state.lastMessageId,
    senderPhotoUrl: senderLargeIcon ?? '',
    url: state.url,
  };
  const actions = state.recipientUserId
    ? [
        ...(state.lastMessageId
          ? [
              {
                title: '읽음',
                pressAction: { id: CHAT_PUSH_ACTION_MARK_READ },
              },
            ]
          : []),
        {
          title: '답장하기',
          pressAction: { id: CHAT_PUSH_ACTION_REPLY },
          input: {
            allowFreeFormInput: true,
            placeholder: '답장 입력',
          },
        },
      ]
    : [];
  const androidOptions = {
    channelId,
    importance: AndroidImportance.HIGH,
    smallIcon: 'notification_icon',
    ...(senderLargeIcon ? { largeIcon: senderLargeIcon, circularLargeIcon: true } : {}),
    pressAction: { id: 'default' },
    groupId: state.groupId,
    showTimestamp: true,
    timestamp: state.updatedAt,
    style: {
      type: AndroidStyle.BIGTEXT,
      text: expandedText,
    },
    actions: actions as never,
  } as never;

  await notifee.displayNotification({
    id: state.notificationId,
    title: state.title,
    body: collapsedBody,
    data: notificationData,
    android: androidOptions,
  });
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
  if (!consumeNotifeeDisplayOnceGlobalSync(rm)) {
    ginitNotifyDbg('fcm-notifee-display', 'skip_duplicate_message_id', { messageId: rm.messageId });
    return;
  }
  await ensureGinitFcmNotifeeChannel();
  const channelId = await getGinitFcmDisplayNotifeeChannelId();
  const prefSnap = await loadProfileNotificationSoundId();
  const rawSnap = notifeeAndroidRawBaseName(prefSnap);
  const chatInput = parseChatPushDisplayData(data, title, body);
  ginitNotifyDbg('fcm-notifee-display', 'display', {
    messageId: rm.messageId,
    action: action || undefined,
    meetingId: meetingId || undefined,
    androidChannelId: channelId,
    notificationSoundPref: prefSnap,
    notifeeRawHint: rawSnap,
    chatGrouped: Boolean(chatInput),
  });
  if (chatInput) {
    const state = await upsertChatPushNotificationState(chatInput);
    await displayChatPushNotificationAndroid(state, data, channelId);
    return;
  }
  await notifee.displayNotification({
    title,
    body,
    data,
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      smallIcon: 'notification_icon',
      pressAction: { id: 'default' },
    },
  });
}
