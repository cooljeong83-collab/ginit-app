/**
 * 채팅방 읽음: 로컬 Watermelon 즉시 반영 → Supabase `chat_mark_read` (실패 시 outbox 재시도).
 */
import { Q } from '@nozbe/watermelondb';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';
import { meetingChatRoomIdsForLocalUnread } from '@/src/lib/chat-meeting-room-id-mirror';
import { markRecentUnreadBroadcast, markRecentUnreadBroadcastMany } from '@/src/lib/chat-unread-recent-broadcast';
import { chatMarkReadRpc } from '@/src/lib/chat-supabase-delta';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { writeMeetingChatReadReceipt } from '@/src/lib/meeting-chat';
import {
  clearLocalChatRoomUnread,
  markLocalChatRoomReadState,
  upsertLocalChatRoomSummary,
} from '@/src/lib/offline-chat/offline-chat-rooms';
import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { updateSocialChatReadReceipt } from '@/src/lib/social-chat-rooms';
import { database } from '@/src/watermelon';

export type ChatMarkReadInput = {
  roomKind: ChatRoomKindDelta;
  roomId: string;
  meAppUserId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  readMessageId: string;
  readAtMs?: number;
  lastReadSeq?: number | null;
};

function roomTypeFromKind(kind: ChatRoomKindDelta): OfflineChatRoomType {
  return kind === 'social_dm' ? 'social_dm' : 'meeting';
}

function maxPositiveSeq(...values: Array<number | null | undefined>): number | null {
  let best = 0;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      best = Math.max(best, Math.floor(v));
    }
  }
  return best > 0 ? best : null;
}

/** `last_message_id`만 갱신되고 `last_server_seq`가 뒤처진 요약 행 보정용 */
async function resolveServerSeqForLocalMessage(
  roomType: OfflineChatRoomType,
  roomId: string,
  messageId: string,
): Promise<number | null> {
  const db = database;
  const mid = messageId.trim();
  if (!db || !mid || mid.startsWith('local:')) return null;
  const rows = await db
    .get('chat_messages')
    .query(Q.where('room_id', roomId), Q.where('room_type', roomType), Q.where('message_id', mid))
    .fetch();
  const row = rows[0] as { serverSeq?: number | null } | undefined;
  const seq = row?.serverSeq;
  return typeof seq === 'number' && Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : null;
}

/**
 * 메시지 리스트 로드 전 — Watermelon `chat_rooms` 요약(목록에서 이미 알고 있는 마지막 메시지·seq)으로 읽음 입력을 만듭니다.
 */
export async function buildChatMarkReadInputFromLocalRoom(args: {
  roomKind: ChatRoomKindDelta;
  roomId: string;
  meAppUserId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
}): Promise<ChatMarkReadInput | null> {
  const db = database;
  const rid = args.roomId.trim();
  const me = (normalizeParticipantId(args.meAppUserId) || args.meAppUserId).trim();
  if (!db || !rid || !me) return null;

  const roomType = roomTypeFromKind(args.roomKind);
  const rows = await db.get('chat_rooms').query(Q.where('room_id', rid), Q.where('room_type', roomType)).fetch();
  const row = rows[0] as {
    lastMessageId?: string | null;
    lastServerSeq?: number | null;
    readMessageId?: string | null;
    unreadCount?: number | null;
    pendingReadLastSeq?: number | null;
    pendingReadMessageId?: string | null;
  } | undefined;
  if (!row) return null;

  const pendingSeq =
    typeof row.pendingReadLastSeq === 'number' && Number.isFinite(row.pendingReadLastSeq) && row.pendingReadLastSeq > 0
      ? Math.floor(row.pendingReadLastSeq)
      : null;
  const pendingMsg =
    typeof row.pendingReadMessageId === 'string' && row.pendingReadMessageId.trim()
      ? row.pendingReadMessageId.trim()
      : null;

  const tailMsg =
    typeof row.lastMessageId === 'string' && row.lastMessageId.trim() ? row.lastMessageId.trim() : '';
  const tailSeq =
    typeof row.lastServerSeq === 'number' && Number.isFinite(row.lastServerSeq) && row.lastServerSeq > 0
      ? Math.floor(row.lastServerSeq)
      : null;

  const readMessageId = pendingMsg || tailMsg;
  if (!readMessageId || readMessageId.startsWith('local:')) return null;

  const messageSeq = await resolveServerSeqForLocalMessage(roomType, rid, readMessageId);
  const effectiveTailSeq = maxPositiveSeq(tailSeq, messageSeq);
  const lastReadSeq = pendingSeq ?? effectiveTailSeq;
  const unread =
    typeof row.unreadCount === 'number' && Number.isFinite(row.unreadCount) ? Math.max(0, Math.floor(row.unreadCount)) : 0;
  const alreadyReadLocally =
    unread === 0 &&
    !pendingSeq &&
    typeof row.readMessageId === 'string' &&
    row.readMessageId.trim() === readMessageId &&
    lastReadSeq != null &&
    effectiveTailSeq != null &&
    lastReadSeq >= effectiveTailSeq;

  if (alreadyReadLocally) return null;

  return {
    roomKind: args.roomKind,
    roomId: rid,
    meAppUserId: me,
    ownerUserId: args.ownerUserId ?? me,
    peerUserId: args.peerUserId ?? null,
    readMessageId,
    readAtMs: Date.now(),
    lastReadSeq,
  };
}

function resolveLastReadSeq(input: ChatMarkReadInput): number | null {
  const direct = input.lastReadSeq;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    return Math.floor(direct);
  }
  return null;
}

/** 1단계: Watermelon `chat_messages.is_read` + 방 unread 0 + 읽음 outbox */
export async function markChatRoomReadLocally(input: ChatMarkReadInput): Promise<void> {
  const db = database;
  const rid = input.roomId.trim();
  const me = (normalizeParticipantId(input.meAppUserId) || input.meAppUserId).trim();
  const msgId = input.readMessageId.trim();
  if (!db || !rid || !me || !msgId || msgId.startsWith('local:')) return;

  const roomType = roomTypeFromKind(input.roomKind);
  const readAtMs = typeof input.readAtMs === 'number' && Number.isFinite(input.readAtMs) ? Math.floor(input.readAtMs) : Date.now();
  const lastReadSeq = resolveLastReadSeq(input);

  /** 이미 동일 읽음 포인터로 맞춰져 있으면 DB write·요약 upsert 생략(Realtime 루프에서의 로그·부하 감소) */
  const snapRows = await db.get('chat_rooms').query(Q.where('room_id', rid), Q.where('room_type', roomType)).fetch();
  const snap = snapRows[0] as {
    unreadCount?: number | null;
    readMessageId?: string | null;
    lastReadServerSeq?: number | null;
    pendingReadLastSeq?: number | null;
    pendingReadMessageId?: string | null;
  } | undefined;
  if (snap && lastReadSeq != null && lastReadSeq > 0) {
    const uc =
      typeof snap.unreadCount === 'number' && Number.isFinite(snap.unreadCount) ? Math.max(0, Math.floor(snap.unreadCount)) : 0;
    const lrs =
      typeof snap.lastReadServerSeq === 'number' && Number.isFinite(snap.lastReadServerSeq)
        ? Math.max(0, Math.floor(snap.lastReadServerSeq))
        : 0;
    const prs =
      typeof snap.pendingReadLastSeq === 'number' && Number.isFinite(snap.pendingReadLastSeq)
        ? Math.max(0, Math.floor(snap.pendingReadLastSeq))
        : 0;
    const localReadSeq = Math.max(lrs, prs);
    if (uc === 0 && localReadSeq >= lastReadSeq) {
      return;
    }
  }

  let readCutoffMs = readAtMs;
  if (lastReadSeq == null) {
    const anchor = await db
      .get('chat_messages')
      .query(Q.where('room_id', rid), Q.where('room_type', roomType), Q.where('message_id', msgId))
      .fetch();
    const row = anchor[0] as { createdAtMs?: number } | undefined;
    if (typeof row?.createdAtMs === 'number' && Number.isFinite(row.createdAtMs)) {
      readCutoffMs = Math.max(readCutoffMs, Math.floor(row.createdAtMs));
    }
  }

  await db.write(async () => {
    const roomRows = await db.get('chat_rooms').query(Q.where('room_id', rid), Q.where('room_type', roomType)).fetch();
    const room = roomRows[0];

    const markMessageRead = async (row: any) => {
      const seq =
        typeof row.serverSeq === 'number' && Number.isFinite(row.serverSeq) ? Math.max(0, Math.floor(row.serverSeq)) : 0;
      const created = typeof row.createdAtMs === 'number' && Number.isFinite(row.createdAtMs) ? row.createdAtMs : 0;
      if (row.isRead === true) return;
      if (lastReadSeq != null && lastReadSeq > 0) {
        if (seq > 0 && seq > lastReadSeq) return;
        if (seq <= 0 && created > readCutoffMs) return;
      } else if (created > readCutoffMs) {
        return;
      }
      await row.update((r: any) => {
        r.isRead = true;
      });
    };

    if (lastReadSeq != null && lastReadSeq > 0) {
      const withSeq = await db
        .get('chat_messages')
        .query(Q.where('room_id', rid), Q.where('room_type', roomType), Q.where('server_seq', Q.lte(lastReadSeq)))
        .fetch();
      for (const m of withSeq) {
        await markMessageRead(m);
      }
      const noSeq = await db
        .get('chat_messages')
        .query(
          Q.where('room_id', rid),
          Q.where('room_type', roomType),
          Q.where('server_seq', null),
          Q.where('created_at_ms', Q.lte(readCutoffMs)),
        )
        .fetch();
      for (const m of noSeq) {
        await markMessageRead(m);
      }
    } else {
      const byTime = await db
        .get('chat_messages')
        .query(Q.where('room_id', rid), Q.where('room_type', roomType), Q.where('created_at_ms', Q.lte(readCutoffMs)))
        .fetch();
      for (const m of byTime) {
        await markMessageRead(m);
      }
    }

    if (room) {
      await room.update((r: any) => {
        const prev =
          typeof r.lastReadServerSeq === 'number' && Number.isFinite(r.lastReadServerSeq)
            ? Math.max(0, Math.floor(r.lastReadServerSeq))
            : 0;
        if (lastReadSeq != null && lastReadSeq > prev) {
          r.lastReadServerSeq = lastReadSeq;
        }
        if (lastReadSeq != null && lastReadSeq > 0) {
          r.pendingReadLastSeq = lastReadSeq;
          r.pendingReadMessageId = msgId;
          r.pendingReadAtMs = readAtMs;
        }
      });
    }
  });

  const clearUnreadArgs = {
    ownerUserId: input.ownerUserId ?? me,
    readMessageId: msgId,
    readAtMs,
  };
  if (input.roomKind === 'meeting') {
    const mirrorIds = await meetingChatRoomIdsForLocalUnread(me, rid);
    const targets = mirrorIds.length > 0 ? mirrorIds : [rid];
    for (const localRoomId of targets) {
      await clearLocalChatRoomUnread({
        roomType: 'meeting',
        roomId: localRoomId,
        ...clearUnreadArgs,
      });
    }
    markRecentUnreadBroadcastMany('meeting', targets);
  } else {
    await clearLocalChatRoomUnread({
      roomType,
      roomId: rid,
      ...clearUnreadArgs,
    });
    markRecentUnreadBroadcast('social_dm', rid);
  }
  await markLocalChatRoomReadState({
    roomType,
    roomId: rid,
    ownerUserId: input.ownerUserId ?? me,
    peerUserId: input.peerUserId,
    userId: me,
    readMessageId: msgId,
    readAtMs,
  });
  if (lastReadSeq != null && lastReadSeq > 0) {
    await upsertLocalChatRoomSummary({
      roomType,
      roomId: rid,
      ownerUserId: input.ownerUserId ?? me,
      lastReadServerSeq: lastReadSeq,
    });
  }
}

export async function clearChatReadOutbox(roomKind: ChatRoomKindDelta, roomId: string): Promise<void> {
  const db = database;
  const rid = roomId.trim();
  if (!db || !rid) return;
  const roomType = roomTypeFromKind(roomKind);
  await db.write(async () => {
    const rows = await db.get('chat_rooms').query(Q.where('room_id', rid), Q.where('room_type', roomType)).fetch();
    const row = rows[0];
    if (!row) return;
    await row.update((r: any) => {
      r.pendingReadLastSeq = null;
      r.pendingReadMessageId = null;
      r.pendingReadAtMs = null;
    });
  });
}

/** 2단계: Supabase 읽음 RPC (모임은 ledger 병행 경로 포함) */
export async function syncChatMarkReadToServer(input: ChatMarkReadInput): Promise<void> {
  const rid = input.roomId.trim();
  const me = (normalizeParticipantId(input.meAppUserId) || input.meAppUserId).trim();
  const msgId = input.readMessageId.trim();
  if (!rid || !me || !msgId || msgId.startsWith('local:')) {
    throw new Error('invalid_mark_read_args');
  }

  const lastReadSeq = resolveLastReadSeq(input);

  if (input.roomKind === 'meeting') {
    await writeMeetingChatReadReceipt(rid, me, msgId, { lastReadSeq });
    if (lastReadSeq == null || lastReadSeq <= 0) {
      throw new Error('mark_read_missing_seq');
    }
    return;
  }

  if (lastReadSeq != null && lastReadSeq > 0) {
    const res = await chatMarkReadRpc({
      meAppUserId: me,
      roomKind: 'social_dm',
      roomId: rid,
      lastReadSeq,
    });
    if (!res.ok) {
      throw new Error(res.error ?? 'chat_mark_read_failed');
    }
    ginitNotifyDbg('BubbleRead', 'chat_mark_read_ok', { roomId: rid, lastReadSeq });
    return;
  }

  await updateSocialChatReadReceipt(rid, me, msgId);
}

export type FlushPendingChatReadResult = { flushed: number; failed: number };

/** 네트워크 복구·포그라운드: outbox에 남은 읽음 RPC 일괄 재시도 */
export async function flushPendingChatReadOutbox(meAppUserId: string): Promise<FlushPendingChatReadResult> {
  const db = database;
  const me = (normalizeParticipantId(meAppUserId) || meAppUserId).trim();
  if (!db || !me) return { flushed: 0, failed: 0 };

  const rows = await db
    .get('chat_rooms')
    .query(Q.where('pending_read_last_seq', Q.gt(0)))
    .fetch();

  let flushed = 0;
  let failed = 0;

  for (const row of rows) {
    const r = row as {
      roomId?: string;
      roomType?: string;
      pendingReadLastSeq?: number | null;
      pendingReadMessageId?: string | null;
      pendingReadAtMs?: number | null;
      ownerUserId?: string | null;
      peerUserId?: string | null;
      unreadCount?: number | null;
      lastServerSeq?: number | null;
    };
    const rid = typeof r.roomId === 'string' ? r.roomId.trim() : '';
    const rt = r.roomType === 'social_dm' ? 'social_dm' : r.roomType === 'meeting' ? 'meeting' : null;
    const seq =
      typeof r.pendingReadLastSeq === 'number' && Number.isFinite(r.pendingReadLastSeq)
        ? Math.max(0, Math.floor(r.pendingReadLastSeq))
        : 0;
    const msgId = typeof r.pendingReadMessageId === 'string' ? r.pendingReadMessageId.trim() : '';
    if (!rid || !rt || seq <= 0 || !msgId) continue;

    const unread =
      typeof r.unreadCount === 'number' && Number.isFinite(r.unreadCount) ? Math.max(0, Math.floor(r.unreadCount)) : 0;
    const lastSrv =
      typeof r.lastServerSeq === 'number' && Number.isFinite(r.lastServerSeq) ? Math.max(0, Math.floor(r.lastServerSeq)) : 0;
    /**
     * `chat_mark_read`는 `chat_reset_room_unread`로 방 전체 unread를 0으로 만듭니다.
     * pending이 남은 채 새 메시지가 오면(로컬 unread>0 또는 tail seq 증가) stale flush가 서버·탭 배지를 지웁니다.
     */
    if (unread > 0 || (lastSrv > seq && lastSrv > 0)) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[chat-mark-read] skip_stale_outbox_flush', {
          roomKind: rt,
          roomId: rid.slice(-12),
          unread,
          lastSrv,
          pendingSeq: seq,
        });
      }
      await clearChatReadOutbox(rt, rid);
      continue;
    }

    const owner = typeof r.ownerUserId === 'string' && r.ownerUserId.trim() ? r.ownerUserId.trim() : me;
    try {
      await syncChatMarkReadToServer({
        roomKind: rt,
        roomId: rid,
        meAppUserId: me,
        ownerUserId: owner,
        peerUserId: typeof r.peerUserId === 'string' ? r.peerUserId : null,
        readMessageId: msgId,
        readAtMs: typeof r.pendingReadAtMs === 'number' ? r.pendingReadAtMs : undefined,
        lastReadSeq: seq,
      });
      await clearChatReadOutbox(rt, rid);
      flushed += 1;
      ginitNotifyDbg('BubbleRead', 'outbox_flush_ok', { roomKind: rt, roomId: rid.slice(-12), seq });
    } catch (e) {
      failed += 1;
      if (__DEV__) {
        console.warn('[chat-mark-read] outbox flush failed', rid, e);
      }
    }
  }

  return { flushed, failed };
}

export async function markChatRoomReadWithLocalFirst(input: ChatMarkReadInput): Promise<void> {
  await markChatRoomReadLocally(input);
  try {
    await syncChatMarkReadToServer(input);
    await clearChatReadOutbox(input.roomKind, input.roomId);
  } catch (e) {
    ginitNotifyDbg('BubbleRead', 'mark_read_server_deferred', {
      roomKind: input.roomKind,
      roomId: input.roomId.slice(-12),
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
