import { Q } from '@nozbe/watermelondb';

import {
  upsertLocalChatRoomSummary,
  type LocalChatRoomSummaryInput,
} from '@/src/lib/offline-chat/offline-chat-rooms';
import {
  isValidSocialDmPeerForViewer,
  parsePeerFromSocialRoomId,
  socialDmRoomId,
} from '@/src/lib/social-chat-rooms';
import { markRecentUnreadBroadcastMany } from '@/src/lib/chat-unread-recent-broadcast';
import { database } from '@/src/watermelon';

type SocialListSurfaceUpsertInput = Omit<LocalChatRoomSummaryInput, 'roomType' | 'roomId'>;

async function resolvePeerForSocialLocalRoomId(meAppUserId: string, roomId: string): Promise<string | null> {
  const me = meAppUserId.trim();
  const rid = roomId.trim();
  if (!me || !rid) return null;

  const fromComposite = parsePeerFromSocialRoomId(rid, me);
  if (fromComposite) return fromComposite;

  const db = database;
  if (!db) return null;
  const rows = await db.get('chat_rooms').query(Q.where('room_id', rid), Q.where('room_type', 'social_dm')).fetch();
  const peer = typeof (rows[0] as { peerUserId?: string | null } | undefined)?.peerUserId === 'string'
    ? (rows[0] as { peerUserId: string }).peerUserId.trim()
    : '';
  return peer || null;
}

/** 채팅 탭 친구 목록이 쓰는 `social_…` 키 — canonical UUID와 다를 수 있음 */
function primarySocialListRoomId(meAppUserId: string, serverRoomId: string, peer: string | null): string {
  const rid = serverRoomId.trim();
  if (rid.startsWith('social_')) return rid;
  if (peer && isValidSocialDmPeerForViewer(meAppUserId, peer)) return socialDmRoomId(meAppUserId, peer);
  return rid;
}

function socialLocalRoomIdsForMirror(meAppUserId: string, serverRoomId: string, peer: string | null): string[] {
  const rid = serverRoomId.trim();
  const out = new Set<string>([rid]);
  if (peer && isValidSocialDmPeerForViewer(meAppUserId, peer)) {
    out.add(socialDmRoomId(meAppUserId, peer));
  }
  const primary = primarySocialListRoomId(meAppUserId, rid, peer);
  out.add(primary);
  return [...out];
}

/**
 * 친구 DM: Watermelon `chat_rooms`의 canonical UUID와 `social_{a}__{b}` 화면 키에
 * 목록 미리보기·시간 스텁을 동시 반영합니다. 미읽음은 목록이 보는 primary 키에만 적용해 배지 이중 합산을 막습니다.
 */
export async function upsertSocialDmListSurfaceAcrossLocalRoomIds(
  meAppUserId: string,
  serverRoomId: string,
  input: SocialListSurfaceUpsertInput,
): Promise<void> {
  const me = meAppUserId.trim();
  const serverId = serverRoomId.trim();
  if (!me || !serverId) return;

  const peer =
    (typeof input.peerUserId === 'string' ? input.peerUserId.trim() : '') ||
    (await resolvePeerForSocialLocalRoomId(me, serverId));
  const primary = primarySocialListRoomId(me, serverId, peer);
  const targets = socialLocalRoomIdsForMirror(me, serverId, peer);
  const touchesUnread = input.unreadCount !== undefined || input.forceServerUnread !== undefined;

  for (const localRoomId of targets) {
    const isPrimary = localRoomId === primary;
    await upsertLocalChatRoomSummary({
      ...input,
      roomType: 'social_dm',
      roomId: localRoomId,
      ownerUserId: input.ownerUserId ?? me,
      peerUserId: peer || input.peerUserId,
      isGroup: false,
      unreadCount: touchesUnread ? (isPrimary ? input.unreadCount : 0) : input.unreadCount,
      forceServerUnread: touchesUnread ? (isPrimary ? input.forceServerUnread : true) : input.forceServerUnread,
    });
  }

  if (input.forceServerUnread) {
    markRecentUnreadBroadcastMany('social_dm', targets);
  }
}
