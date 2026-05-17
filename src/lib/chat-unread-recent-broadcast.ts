/** `unread_update` 브로드캐스트 직후 `refresh_list` → 전체 unread RPC가 낮은 값으로 덮는 레이스 완화 */

const RECENT_BROADCAST_MS = 2_800;

const recentByRoomKey = new Map<string, number>();

export function chatUnreadRoomKey(roomKind: 'meeting' | 'social_dm', roomId: string): string {
  return `${roomKind}:${roomId.trim()}`;
}

export function markRecentUnreadBroadcast(roomKind: 'meeting' | 'social_dm', roomId: string): void {
  const rid = roomId.trim();
  if (!rid) return;
  recentByRoomKey.set(chatUnreadRoomKey(roomKind, rid), Date.now());
}

export function markRecentUnreadBroadcastMany(roomKind: 'meeting' | 'social_dm', roomIds: Iterable<string>): void {
  const now = Date.now();
  for (const id of roomIds) {
    const rid = id.trim();
    if (!rid) continue;
    recentByRoomKey.set(chatUnreadRoomKey(roomKind, rid), now);
  }
}

export function wasRecentUnreadBroadcast(roomKind: 'meeting' | 'social_dm', roomId: string): boolean {
  const rid = roomId.trim();
  if (!rid) return false;
  const at = recentByRoomKey.get(chatUnreadRoomKey(roomKind, rid));
  if (at == null) return false;
  if (Date.now() - at > RECENT_BROADCAST_MS) {
    recentByRoomKey.delete(chatUnreadRoomKey(roomKind, rid));
    return false;
  }
  return true;
}
