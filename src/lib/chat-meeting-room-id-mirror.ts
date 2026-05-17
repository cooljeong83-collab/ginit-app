import { Q } from '@nozbe/watermelondb';

import { chatMeetingSummaryForMeRpc } from '@/src/lib/chat-supabase-delta';
import { markRecentUnreadBroadcastMany } from '@/src/lib/chat-unread-recent-broadcast';
import { upsertLocalChatRoomSummary } from '@/src/lib/offline-chat/offline-chat-rooms';
import { database } from '@/src/watermelon';

const cache = new Map<string, { ids: string[]; at: number }>();
const TTL_MS = 60_000;

/**
 * 모임 채팅: Watermelon `chat_rooms.room_id`(화면 키) ↔ Supabase `chat_room_participants.room_id`(canonical UUID)를
 * 같은 unread로 맞추기 위한 후보 id 목록.
 */
export async function meetingChatRoomIdsForLocalUnread(meAppUserId: string, roomId: string): Promise<string[]> {
  const me = meAppUserId.trim();
  const rid = roomId.trim();
  if (!me || !rid) return [];

  const cacheKey = `${me}\0${rid}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

  const ids = new Set<string>([rid]);
  try {
    const sum = await chatMeetingSummaryForMeRpc({ meAppUserId: me, meetingId: rid });
    const canon = sum.canonical_room_id?.trim();
    if (canon) ids.add(canon);
  } catch {
    /* noop */
  }

  const out = [...ids];
  cache.set(cacheKey, { ids: out, at: Date.now() });
  return out;
}

export function clearMeetingChatRoomIdMirrorCache(): void {
  cache.clear();
}

type MeetingUnreadUpsertInput = Parameters<typeof upsertLocalChatRoomSummary>[0];

/**
 * 모임 unread는 Watermelon에 화면 키·canonical 행이 둘 다 있을 수 있어, **한 곳만** 갱신하고 나머지는 0으로 맞춥니다.
 */
export async function upsertMeetingUnreadAcrossLocalRoomIds(
  meAppUserId: string,
  serverRoomId: string,
  input: Omit<MeetingUnreadUpsertInput, 'roomType' | 'roomId'>,
): Promise<void> {
  const me = meAppUserId.trim();
  const serverId = serverRoomId.trim();
  if (!me || !serverId) return;

  const candidates = await meetingChatRoomIdsForLocalUnread(me, serverId);
  const db = database;
  const existingIds: string[] = [];
  if (db) {
    for (const id of candidates) {
      const rows = await db.get('chat_rooms').query(Q.where('room_id', id), Q.where('room_type', 'meeting')).fetch();
      if (rows[0]) existingIds.push(id);
    }
  }

  let primary = serverId;
  if (existingIds.length > 0) {
    const nonServer = existingIds.filter((id) => id !== serverId);
    primary = nonServer[0] ?? existingIds[0]!;
  }

  const allTargets = new Set([...candidates, primary]);
  for (const localRoomId of allTargets) {
    const isPrimary = localRoomId === primary;
    await upsertLocalChatRoomSummary({
      ...input,
      roomType: 'meeting',
      roomId: localRoomId,
      ownerUserId: input.ownerUserId ?? me,
      isGroup: true,
      unreadCount: isPrimary ? input.unreadCount : 0,
      forceServerUnread: isPrimary ? input.forceServerUnread : true,
      touchListSurface: isPrimary ? input.touchListSurface : false,
    });
  }
  if (input.forceServerUnread) {
    markRecentUnreadBroadcastMany('meeting', allTargets);
  }
}
