/**
 * 사용자별 Realtime 토픽 `user_notifications:{profiles.id}` (private) — Edge `chat-user-notifications-broadcast` 가
 * `unread_update` / `refresh_list` 브로드캐스트합니다. 실제 구독은 `subscribeGlobalUserSyncChannel` 멀티플렉스 한 곳에서만 수행합니다.
 */

export const USER_CHAT_UNREAD_BROADCAST_EVENT = 'unread_update';
export const USER_CHAT_REFRESH_LIST_BROADCAST_EVENT = 'refresh_list';

/** Realtime wire 페이로드 (Edge와 동일 키) */
export type UserChatUnreadWirePayload = {
  room_id: string;
  last_message: string;
  unread_count: number;
  last_message_id?: string;
  message_kind?: string;
};

export type SubscribeUserChatBroadcastCallbacks = {
  onUnreadUpdate: (p: UserChatUnreadWirePayload) => void;
  /** DM 목록·요약 RPC 재동기화(Edge `chat_rooms` 웹훅 또는 메시지 INSERT 시 함께 전송) */
  onRefreshList?: () => void;
  onChannelError?: (message: string) => void;
};

export function parseUserChatUnreadCompositeRoomId(
  composite: string,
): { roomKind: 'meeting' | 'social_dm'; roomId: string } | null {
  const raw = typeof composite === 'string' ? composite.trim() : '';
  const i = raw.indexOf('|');
  if (i <= 0 || i >= raw.length - 1) return null;
  const kind = raw.slice(0, i).trim().toLowerCase();
  const id = raw.slice(i + 1).trim();
  if (!id) return null;
  if (kind === 'meeting') return { roomKind: 'meeting', roomId: id };
  if (kind === 'social_dm') return { roomKind: 'social_dm', roomId: id };
  return null;
}
