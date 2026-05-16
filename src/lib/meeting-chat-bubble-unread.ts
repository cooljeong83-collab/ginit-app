import type { LocalChatRoomSummary } from '@/src/lib/offline-chat/offline-chat-rooms';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { normalizeParticipantId } from '@/src/lib/app-user-id';

export type MergedRoomReadMaps = {
  messageReadMessageIdBy: Record<string, string>;
  messageReadAtMsBy: Record<string, number>;
  messageReadLastSeqBy: Record<string, number>;
};

/** 동일 방의 `chat_rooms` 행이 여러 `room_id`(라우트/정규 id)로 중복될 때 읽음 JSON을 한 맵으로 합칩니다. */
export function mergeRoomReadSummaries(
  rows: Pick<LocalChatRoomSummary, 'messageReadMessageIdBy' | 'messageReadAtMsBy' | 'messageReadLastSeqBy'>[],
): MergedRoomReadMaps {
  const bestAt: Record<string, number> = {};
  const bestId: Record<string, string> = {};
  const bestSeq: Record<string, number> = {};
  for (const r of rows) {
    const idMap = r.messageReadMessageIdBy ?? {};
    const atMap = r.messageReadAtMsBy ?? {};
    const seqMap = r.messageReadLastSeqBy ?? {};
    const keys = new Set([...Object.keys(idMap), ...Object.keys(atMap), ...Object.keys(seqMap)]);
    for (const k of keys) {
      const rawAt = atMap[k];
      const at = typeof rawAt === 'number' && Number.isFinite(rawAt) ? Math.max(0, Math.floor(rawAt)) : 0;
      const id = (idMap[k] ?? '').trim();
      const prevAt = bestAt[k] ?? 0;
      if (at > prevAt) {
        bestAt[k] = at;
        if (id) bestId[k] = id;
      } else if (at === prevAt && id && (!bestId[k] || bestId[k] !== id)) {
        bestId[k] = id;
      }
      const rawSeq = seqMap[k];
      const seq = typeof rawSeq === 'number' && Number.isFinite(rawSeq) ? Math.max(0, Math.floor(rawSeq)) : 0;
      if (seq > (bestSeq[k] ?? 0)) bestSeq[k] = seq;
    }
  }
  return { messageReadMessageIdBy: bestId, messageReadAtMsBy: bestAt, messageReadLastSeqBy: bestSeq };
}

function participantKeyMatches(mapKey: string, pid: string): boolean {
  const pk = normalizeParticipantId(pid) ?? pid.trim();
  const nk = normalizeParticipantId(mapKey) ?? mapKey.trim();
  return Boolean(pk && nk && pk === nk);
}

function pickNumericByParticipant(map: Record<string, number> | null | undefined, pid: string): number {
  if (!map || typeof map !== 'object') return 0;
  const direct = map[pid];
  if (typeof direct === 'number' && Number.isFinite(direct)) return Math.max(0, Math.floor(direct));
  for (const [k, v] of Object.entries(map)) {
    if (!participantKeyMatches(k, pid)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  }
  return 0;
}

/** `readMessageIdBy` 키가 여러 형태여도 정규화된 pid로 마지막 읽은 메시지 id */
export function lastReadMessageIdForParticipant(readBy: Record<string, string> | null | undefined, pid: string): string {
  if (!readBy || typeof readBy !== 'object') return '';
  const pick = (val: unknown) => (typeof val === 'string' ? val.trim() : String(val ?? '').trim());
  const direct = pick((readBy as Record<string, unknown>)[pid]);
  if (direct) return direct;
  for (const [k, v] of Object.entries(readBy)) {
    const id = pick(v);
    if (!id) continue;
    const nk = normalizeParticipantId(k) ?? k.trim();
    if (nk === pid) return id;
  }
  return '';
}

function messageTimeMs(m: MeetingChatMessage | null | undefined): number {
  const ca = m?.createdAt;
  if (ca && typeof (ca as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (ca as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/** 모임 채팅: 내 말풍선 미읽음 인원 수 (Watermelon `chat_rooms` 읽음 맵을 인자로 전달) */
export function computeMeetingUnreadCountForSentMessage(args: {
  message: MeetingChatMessage;
  messageIndex: number;
  messageIndexById: Map<string, number>;
  participantIds: readonly string[];
  myId: string;
  readMessageIdByUser: Record<string, string>;
  readAtMsByUser: Record<string, number>;
  readLastSeqByUser?: Record<string, number>;
  messageServerSeq?: number | null;
}): number {
  const {
    message,
    messageIndex,
    messageIndexById,
    participantIds,
    myId,
    readMessageIdByUser,
    readAtMsByUser,
    readLastSeqByUser,
    messageServerSeq,
  } = args;
  const messageMs = messageTimeMs(message);
  if (!messageMs) return 0;
  const idxMsg = messageIndex;
  const msgSeq =
    typeof messageServerSeq === 'number' && Number.isFinite(messageServerSeq) && messageServerSeq > 0
      ? Math.floor(messageServerSeq)
      : typeof message.serverSeq === 'number' && Number.isFinite(message.serverSeq) && message.serverSeq > 0
        ? Math.floor(message.serverSeq)
        : 0;
  let unread = 0;
  for (const pid of participantIds) {
    if (myId && pid === myId) continue;
    if (msgSeq > 0) {
      const peerSeq = pickNumericByParticipant(readLastSeqByUser, pid);
      if (peerSeq >= msgSeq) continue;
    }
    const lastId = lastReadMessageIdForParticipant(readMessageIdByUser, pid);
    if (lastId) {
      const readIdx = messageIndexById.get(lastId);
      if (readIdx != null && readIdx <= idxMsg) continue;
    }
    const ms = pickNumericByParticipant(readAtMsByUser, pid);
    if (!ms || ms < messageMs) unread += 1;
  }
  return unread;
}

/** 1:1 DM: 상대 미읽음 1 / 읽음 0 */
export function computeDmUnreadCountForSentMessage(args: {
  message: MeetingChatMessage;
  messageIndex: number;
  messageIndexById: Map<string, number>;
  peerReadMessageId: string | null | undefined;
  peerReadAtMs: number;
  peerReadLastSeq?: number;
  peerReadStateReady: boolean;
  messageServerSeq?: number | null;
}): number {
  const {
    message,
    messageIndex,
    messageIndexById,
    peerReadMessageId,
    peerReadAtMs,
    peerReadLastSeq = 0,
    peerReadStateReady,
    messageServerSeq,
  } = args;
  if (!peerReadStateReady) return 0;
  const msgMs = messageTimeMs(message);
  if (!msgMs) return 0;
  const msgSeq =
    typeof messageServerSeq === 'number' && Number.isFinite(messageServerSeq) && messageServerSeq > 0
      ? Math.floor(messageServerSeq)
      : typeof message.serverSeq === 'number' && Number.isFinite(message.serverSeq) && message.serverSeq > 0
        ? Math.floor(message.serverSeq)
        : 0;
  if (msgSeq > 0 && peerReadLastSeq >= msgSeq) return 0;
  const lastId = (peerReadMessageId ?? '').trim();
  if (lastId) {
    const readIdx = messageIndexById.get(lastId);
    if (readIdx != null && readIdx <= messageIndex) return 0;
  }
  if (peerReadAtMs > 0 && peerReadAtMs >= msgMs) return 0;
  return 1;
}

/** Watermelon `chat_rooms` 요약에서 DM 상대 읽음 id/시각 */
export function pickPeerDmReadFromRoomSummary(args: {
  summary: {
    messageReadMessageIdBy: Record<string, string>;
    messageReadAtMsBy: Record<string, number>;
    messageReadLastSeqBy?: Record<string, number>;
  } | null;
  peerId: string;
}): { readMessageId: string | null; readAtMs: number; readLastSeq: number } {
  const { summary, peerId } = args;
  if (!summary) return { readMessageId: null, readAtMs: 0, readLastSeq: 0 };
  const pid = peerId.trim();
  if (!pid) return { readMessageId: null, readAtMs: 0, readLastSeq: 0 };
  const pk = normalizeParticipantId(pid) ?? pid;
  const idMap = summary.messageReadMessageIdBy ?? {};
  const atMap = summary.messageReadAtMsBy ?? {};
  const seqMap = summary.messageReadLastSeqBy ?? {};
  let readMessageId: string | null = null;
  let readAtMs = 0;
  let readLastSeq = 0;
  for (const [k, v] of Object.entries(idMap)) {
    const nk = normalizeParticipantId(k) ?? k.trim();
    if (nk === pk || k.trim() === pid) {
      const id = typeof v === 'string' && v.trim() ? v.trim() : '';
      if (id) readMessageId = id;
      break;
    }
  }
  for (const [k, v] of Object.entries(atMap)) {
    const nk = normalizeParticipantId(k) ?? k.trim();
    if (nk === pk || k.trim() === pid) {
      const ms = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
      if (ms > 0) readAtMs = ms;
      break;
    }
  }
  readLastSeq = pickNumericByParticipant(seqMap, pid);
  return { readMessageId, readAtMs, readLastSeq };
}
