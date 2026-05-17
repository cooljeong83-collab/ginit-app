import { Q } from '@nozbe/watermelondb';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { upsertLocalChatRoomReadState } from '@/src/lib/offline-chat/offline-chat-rooms';
import { database } from '@/src/watermelon';

export type ChatReadPointerRealtimePayload = {
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
};

function parseReadPointerRecord(
  rec: Record<string, unknown> | null | undefined,
): {
  roomKind: ChatRoomKindDelta;
  roomId: string;
  readerAppUserId: string;
  lastReadSeq: number;
  updatedAtMs: number;
} | null {
  if (!rec || typeof rec !== 'object') return null;
  const rkRaw = typeof rec.room_kind === 'string' ? rec.room_kind.trim().toLowerCase() : '';
  if (rkRaw !== 'meeting' && rkRaw !== 'social_dm') return null;
  const roomKind: ChatRoomKindDelta = rkRaw;
  const roomId = typeof rec.room_id === 'string' ? rec.room_id.trim() : '';
  const readerRaw = typeof rec.reader_app_user_id === 'string' ? rec.reader_app_user_id.trim() : '';
  const readerAppUserId = (normalizeParticipantId(readerRaw) || readerRaw).trim();
  if (!roomId || !readerAppUserId) return null;
  const seqRaw = rec.last_read_seq;
  const lastReadSeq =
    typeof seqRaw === 'number' && Number.isFinite(seqRaw)
      ? Math.max(0, Math.floor(seqRaw))
      : Number.isFinite(Number(seqRaw))
        ? Math.max(0, Math.floor(Number(seqRaw)))
        : 0;
  let updatedAtMs = 0;
  const updatedAt = rec.updated_at;
  if (typeof updatedAt === 'string' && updatedAt.trim()) {
    const t = Date.parse(updatedAt);
    if (Number.isFinite(t)) updatedAtMs = t;
  }
  return { roomKind, roomId, readerAppUserId, lastReadSeq, updatedAtMs };
}

async function resolveReadMessageIdForSeq(
  roomKind: ChatRoomKindDelta,
  roomId: string,
  lastReadSeq: number,
): Promise<string | null> {
  const db = database;
  if (!db || lastReadSeq <= 0) return null;
  const rows = await db
    .get('chat_messages')
    .query(
      Q.where('room_id', roomId),
      Q.where('room_type', roomKind),
      Q.where('server_seq', Q.lte(lastReadSeq)),
      Q.sortBy('server_seq', Q.desc),
      Q.take(1),
    )
    .fetch();
  const row = rows[0] as { messageId?: string } | undefined;
  const mid = typeof row?.messageId === 'string' ? row.messageId.trim() : '';
  return mid || null;
}

/**
 * `chat_read_pointers` postgres_changes 페이로드 → Watermelon 읽음 맵 즉시 패치.
 * RPC pull 전에 말풍선 `MessageReadCount`가 seq 기준으로 바로 반응하도록 합니다.
 */
export async function applyChatReadPointerRealtimeToLocal(args: {
  roomKind: ChatRoomKindDelta;
  /** 라우트·canonical 등 로컬 `chat_rooms.room_id` 후보 */
  localRoomIds: readonly string[];
  payload?: ChatReadPointerRealtimePayload | null;
  ownerUserId?: string | null;
  peerUserId?: string | null;
}): Promise<boolean> {
  const parsed =
    parseReadPointerRecord(args.payload?.new ?? null) ?? parseReadPointerRecord(args.payload?.old ?? null);
  if (!parsed) return false;
  if (parsed.roomKind !== args.roomKind) return false;
  if (parsed.lastReadSeq <= 0) return false;

  const routeIds = [...new Set(args.localRoomIds.map((x) => String(x ?? '').trim()).filter(Boolean))];
  const roomIds = [...new Set([parsed.roomId, ...routeIds])];

  let readMessageId: string | null = null;
  for (const tryRoomId of roomIds) {
    readMessageId = await resolveReadMessageIdForSeq(parsed.roomKind, tryRoomId, parsed.lastReadSeq);
    if (readMessageId) break;
  }
  const atMs = parsed.updatedAtMs > 0 ? parsed.updatedAtMs : Date.now();
  const readMessageIdBy: Record<string, string> = {};
  if (readMessageId) readMessageIdBy[parsed.readerAppUserId] = readMessageId;

  for (const roomId of roomIds) {
    await upsertLocalChatRoomReadState({
      roomType: parsed.roomKind,
      roomId,
      ownerUserId: args.ownerUserId ?? undefined,
      peerUserId: args.peerUserId ?? undefined,
      readMessageIdBy,
      readAtMsBy: { [parsed.readerAppUserId]: atMs },
      readLastSeqBy: { [parsed.readerAppUserId]: parsed.lastReadSeq },
      readStateLastAtMs: atMs,
    });
  }

  ginitNotifyDbg('BubbleRead', 'wm_read_state_realtime_patch', {
    roomKind: parsed.roomKind,
    roomId: parsed.roomId.slice(-12),
    reader: parsed.readerAppUserId.slice(-12),
    seq: parsed.lastReadSeq,
    msgSuffix: readMessageId?.slice(-8) ?? null,
  });
  return true;
}
