import type { MeetingChatMessageKind } from '@/src/lib/meeting-chat';

/** Edge `chat-user-notifications-broadcast` → 앱 단일 채널 `unread_update` 수신 후 내부 배포용. */
export type UserUnreadBroadcastPayload = {
  roomKind: 'meeting' | 'social_dm';
  canonicalRoomId: string;
  lastMessage: string;
  lastMessageId: string;
  messageKind: MeetingChatMessageKind;
  unreadCount: number;
};

const listeners = new Set<(p: UserUnreadBroadcastPayload) => void>();

export function subscribeUserUnreadBroadcast(fn: (p: UserUnreadBroadcastPayload) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function publishUserUnreadBroadcast(p: UserUnreadBroadcastPayload): void {
  for (const fn of listeners) {
    try {
      fn(p);
    } catch (e) {
      if (__DEV__) console.warn('[user-unread-broadcast-bus] listener error', e);
    }
  }
}
