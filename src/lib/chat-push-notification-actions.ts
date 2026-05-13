import notifee from '@notifee/react-native';

import {
  CHAT_PUSH_ACTION_MARK_READ,
  CHAT_PUSH_ACTION_REPLY,
  chatPushGroupSummaryNotificationId,
  chatPushMessageNotificationId,
  chatPushNotificationId,
  clearChatPushNotificationState,
  getChatPushNotificationState,
  type ChatPushRoomType,
} from '@/src/lib/chat-push-notification-state';
import { unregisterGinitGroupedNotifications } from '@/src/lib/ginit-notifee-app-group';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { sendMeetingChatTextMessage, writeMeetingChatReadReceipt } from '@/src/lib/meeting-chat';
import { sendSocialChatTextMessage, updateSocialChatReadReceipt } from '@/src/lib/social-chat-rooms';

export type ChatPushNotificationActionId = typeof CHAT_PUSH_ACTION_MARK_READ | typeof CHAT_PUSH_ACTION_REPLY;

function stringValue(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function normalizeRoomType(data: Record<string, unknown>): ChatPushRoomType | null {
  const explicit = stringValue(data, 'roomType');
  if (explicit === 'meeting' || explicit === 'social_dm') return explicit;
  const action = stringValue(data, 'action');
  if (action === 'in_app_chat') return 'meeting';
  if (action === 'in_app_social_dm') return 'social_dm';
  return null;
}

function parseActionData(data: Record<string, unknown>): {
  roomType: ChatPushRoomType;
  roomId: string;
  recipientUserId: string;
  lastMessageId: string;
  notificationId: string;
} | null {
  const roomType = normalizeRoomType(data);
  const roomId = stringValue(data, 'roomId') || stringValue(data, 'meetingId');
  const recipientUserId = stringValue(data, 'recipientUserId');
  const lastMessageId = stringValue(data, 'lastMessageId') || stringValue(data, 'messageId');
  const notificationId = stringValue(data, 'ginitNotificationId');
  if (!roomType || !roomId || !recipientUserId) return null;
  return { roomType, roomId, recipientUserId, lastMessageId, notificationId };
}

export function isChatPushNotificationActionId(actionId: string | undefined): actionId is ChatPushNotificationActionId {
  return actionId === CHAT_PUSH_ACTION_MARK_READ || actionId === CHAT_PUSH_ACTION_REPLY;
}

async function clearRoomNotification(roomType: ChatPushRoomType, roomId: string, explicitNotificationId = ''): Promise<void> {
  const prev = await getChatPushNotificationState(roomType, roomId);
  const childIds = (prev?.messages ?? []).map((message) =>
    chatPushMessageNotificationId(roomType, roomId, message.id),
  );
  const roomNotificationId = chatPushNotificationId(roomType, roomId);
  const groupedIds = [...childIds, roomNotificationId, explicitNotificationId].map((x) => x.trim()).filter(Boolean);
  await clearChatPushNotificationState(roomType, roomId);
  await notifee.cancelNotification(roomNotificationId);
  await notifee.cancelNotification(chatPushGroupSummaryNotificationId(roomType, roomId));
  await Promise.all(groupedIds.map((id) => notifee.cancelNotification(id).catch(() => {})));
  await unregisterGinitGroupedNotifications(groupedIds);
}

async function markChatPushRead(data: Record<string, unknown>): Promise<void> {
  const parsed = parseActionData(data);
  if (!parsed?.lastMessageId) {
    ginitNotifyDbg('chat-push-action', 'read_skip_missing_payload', {
      hasParsed: Boolean(parsed),
      hasLastMessageId: Boolean(parsed?.lastMessageId),
    });
    return;
  }

  if (parsed.roomType === 'meeting') {
    await writeMeetingChatReadReceipt(parsed.roomId, parsed.recipientUserId, parsed.lastMessageId);
  } else {
    await updateSocialChatReadReceipt(parsed.roomId, parsed.recipientUserId, parsed.lastMessageId);
  }
  await clearRoomNotification(parsed.roomType, parsed.roomId, parsed.notificationId);
  ginitNotifyDbg('chat-push-action', 'read_done', { roomType: parsed.roomType, roomId: parsed.roomId });
}

async function replyToChatPush(data: Record<string, unknown>, inputText: string | undefined): Promise<void> {
  const parsed = parseActionData(data);
  const text = String(inputText ?? '').trim();
  if (!parsed || !text) {
    ginitNotifyDbg('chat-push-action', 'reply_skip_missing_payload', {
      hasParsed: Boolean(parsed),
      hasText: Boolean(text),
    });
    return;
  }

  if (parsed.lastMessageId) {
    await markChatPushRead(data).catch(() => {});
  }
  if (parsed.roomType === 'meeting') {
    await sendMeetingChatTextMessage(parsed.roomId, parsed.recipientUserId, text, null);
  } else {
    await sendSocialChatTextMessage(parsed.roomId, parsed.recipientUserId, text, null);
  }
  await clearRoomNotification(parsed.roomType, parsed.roomId, parsed.notificationId);
  ginitNotifyDbg('chat-push-action', 'reply_done', { roomType: parsed.roomType, roomId: parsed.roomId });
}

export async function handleChatPushNotificationAction(
  actionId: string | undefined,
  data: Record<string, unknown> | undefined,
  inputText?: string,
): Promise<boolean> {
  if (!isChatPushNotificationActionId(actionId)) return false;
  if (!data || typeof data !== 'object') {
    ginitNotifyDbg('chat-push-action', 'skip_no_data', { actionId });
    return true;
  }
  try {
    if (actionId === CHAT_PUSH_ACTION_MARK_READ) {
      await markChatPushRead(data);
      return true;
    }
    await replyToChatPush(data, inputText);
    return true;
  } catch (e) {
    ginitNotifyDbg('chat-push-action', 'error', {
      actionId,
      message: e instanceof Error ? e.message : String(e),
    });
    return true;
  }
}
