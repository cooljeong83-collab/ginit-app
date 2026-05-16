import AsyncStorage from '@react-native-async-storage/async-storage';

import { readLocalChatRoomUnreadCount } from '@/src/lib/offline-chat/offline-chat-rooms';

export type ChatPushRoomType = 'meeting' | 'social_dm';

export const CHAT_PUSH_ACTION_MARK_READ = 'chat_mark_read';
export const CHAT_PUSH_ACTION_REPLY = 'chat_reply';

export type ChatPushNotificationMessage = {
  id: string;
  text: string;
  senderName: string;
  senderPhotoUrl: string;
  timestamp: number;
};

export type ChatPushNotificationState = {
  roomType: ChatPushRoomType;
  roomId: string;
  notificationId: string;
  groupId: string;
  title: string;
  url: string;
  recipientUserId: string;
  lastMessageId: string;
  unreadCount: number;
  messages: ChatPushNotificationMessage[];
  updatedAt: number;
};

export type ChatPushDisplayData = {
  roomType: ChatPushRoomType;
  roomId: string;
  title: string;
  body: string;
  url: string;
  recipientUserId: string;
  lastMessageId: string;
  senderName: string;
  senderPhotoUrl: string;
  /** FCM `data` — `unread_count`(Edge·DB 트리거) → `serverUnreadCount` 최우선, 없으면 Watermelon */
  serverUnreadCount?: number;
};

const STORAGE_PREFIX = 'ginit.chat_push_notification.room.v1:';
const STORAGE_INDEX_KEY = 'ginit.chat_push_notification.index.v1';
const MAX_MESSAGES_PER_ROOM = 5;
const MAX_TRACKED_ROOMS = 48;
const STATE_TTL_MS = 1000 * 60 * 60 * 24 * 3;

function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function chatPushRoomKey(roomType: ChatPushRoomType, roomId: string): string {
  return `${roomType}:${roomId.trim()}`;
}

function storageKey(roomType: ChatPushRoomType, roomId: string): string {
  return `${STORAGE_PREFIX}${chatPushRoomKey(roomType, roomId)}`;
}

export function chatPushNotificationId(roomType: ChatPushRoomType, roomId: string): string {
  return `chat_${roomType}_${stableHash(roomId.trim())}`;
}

export function chatPushMessageNotificationId(roomType: ChatPushRoomType, roomId: string, messageId: string): string {
  const mid = messageId.trim() || roomId.trim();
  return `chat_${roomType}_${stableHash(roomId.trim())}_${stableHash(mid)}`;
}

export function chatPushGroupId(roomType: ChatPushRoomType, roomId: string): string {
  return `ginit_chat_${roomType}_${stableHash(roomId.trim())}`;
}

export function chatPushGroupSummaryNotificationId(roomType: ChatPushRoomType, roomId: string): string {
  return `chat_summary_${roomType}_${stableHash(roomId.trim())}`;
}

function stringValue(data: Record<string, string>, key: string): string {
  return String(data[key] ?? '').trim();
}

/**
 * Edge `chat-user-notifications-broadcast`가 FCM `data`에 넣는 값과 동일 키 우선순위.
 * 1) `unread_count` (DB `chat_room_participants` 트리거 반영 후 Edge가 조회)
 * 2) `serverUnreadCount` 3) `unreadCount` (레거시)
 */
function parseServerUnreadCountFromFcmData(data: Record<string, string>): number | undefined {
  const orderedKeys = ['unread_count', 'serverUnreadCount', 'unreadCount'] as const;
  for (const key of orderedKeys) {
    const raw = stringValue(data, key);
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return undefined;
}

function normalizeMeetingChatNotificationTitle(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('「') && t.endsWith('」') && t.length > 2) {
    return t.slice(1, -1).trim() || t;
  }
  return t;
}

export function parseChatPushDisplayData(
  data: Record<string, string>,
  title: string,
  body: string,
): ChatPushDisplayData | null {
  const action = stringValue(data, 'action');
  if (action !== 'in_app_chat' && action !== 'in_app_social_dm') return null;

  const roomType: ChatPushRoomType =
    stringValue(data, 'roomType') === 'social_dm' || action === 'in_app_social_dm' ? 'social_dm' : 'meeting';
  const roomId = stringValue(data, 'roomId') || stringValue(data, 'meetingId');
  if (!roomId) return null;

  const messageText = body.trim() || stringValue(data, 'body') || '새 메시지';
  const fallbackSender = roomType === 'social_dm' ? title.trim() : '새 메시지';
  const senderName = stringValue(data, 'senderName') || fallbackSender || '새 메시지';
  const senderPhotoUrl = stringValue(data, 'senderPhotoUrl') || stringValue(data, 'senderAvatarUrl');
  const recipientUserId = stringValue(data, 'recipientUserId');
  const lastMessageId = stringValue(data, 'lastMessageId') || stringValue(data, 'messageId');
  const url =
    stringValue(data, 'url') ||
    (roomType === 'social_dm' ? `ginitapp://social-chat/${encodeURIComponent(roomId)}` : `ginitapp://meeting-chat/${roomId}`);

  return {
    roomType,
    roomId,
    title:
      roomType === 'meeting'
        ? normalizeMeetingChatNotificationTitle(title.trim() || stringValue(data, 'title') || '채팅')
        : title.trim() || stringValue(data, 'title') || senderName,
    body: messageText,
    url,
    recipientUserId,
    lastMessageId,
    senderName,
    senderPhotoUrl,
    serverUnreadCount: parseServerUnreadCountFromFcmData(data),
  };
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

async function writeIndex(keys: readonly string[]): Promise<void> {
  const uniq = [...new Set(keys.map((x) => x.trim()).filter(Boolean))].slice(-MAX_TRACKED_ROOMS);
  await AsyncStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(uniq));
}

async function readState(roomType: ChatPushRoomType, roomId: string): Promise<ChatPushNotificationState | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(roomType, roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatPushNotificationState;
    if (!parsed || parsed.roomType !== roomType || parsed.roomId !== roomId) return null;
    if (Date.now() - Number(parsed.updatedAt ?? 0) > STATE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getChatPushNotificationState(
  roomType: ChatPushRoomType,
  roomId: string,
): Promise<ChatPushNotificationState | null> {
  return readState(roomType, roomId);
}

export async function clearChatPushNotificationState(roomType: ChatPushRoomType, roomId: string): Promise<void> {
  const key = chatPushRoomKey(roomType, roomId);
  await AsyncStorage.removeItem(storageKey(roomType, roomId));
  const next = (await readIndex()).filter((x) => x !== key);
  await writeIndex(next);
}

export async function upsertChatPushNotificationState(input: ChatPushDisplayData): Promise<ChatPushNotificationState> {
  const now = Date.now();
  const prev = await readState(input.roomType, input.roomId);
  const messageId = input.lastMessageId || `local_${now}_${stableHash(input.body)}`;
  const nextMessages = [
    {
      id: messageId,
      text: input.body,
      senderName: input.senderName,
      senderPhotoUrl: input.senderPhotoUrl,
      timestamp: now,
    },
    ...(prev?.messages ?? []).filter((m) => m.id !== messageId),
  ].slice(0, MAX_MESSAGES_PER_ROOM);

  let resolvedUnread = 0;
  if (typeof input.serverUnreadCount === 'number' && Number.isFinite(input.serverUnreadCount)) {
    resolvedUnread = Math.max(0, Math.floor(input.serverUnreadCount));
  } else {
    resolvedUnread = await readLocalChatRoomUnreadCount({ roomType: input.roomType, roomId: input.roomId });
  }

  const next: ChatPushNotificationState = {
    roomType: input.roomType,
    roomId: input.roomId,
    notificationId: chatPushNotificationId(input.roomType, input.roomId),
    groupId: chatPushGroupId(input.roomType, input.roomId),
    title: input.title,
    url: input.url,
    recipientUserId: input.recipientUserId || prev?.recipientUserId || '',
    lastMessageId: input.lastMessageId || prev?.lastMessageId || '',
    unreadCount: resolvedUnread,
    messages: nextMessages,
    updatedAt: now,
  };

  await AsyncStorage.setItem(storageKey(input.roomType, input.roomId), JSON.stringify(next));
  await writeIndex([...(await readIndex()), chatPushRoomKey(input.roomType, input.roomId)]);
  return next;
}
