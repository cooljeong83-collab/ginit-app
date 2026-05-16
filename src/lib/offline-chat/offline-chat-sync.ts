import { Q } from '@nozbe/watermelondb';

import { database } from '@/src/watermelon';
import { chatPullDeltasRpc, chatPullHistoryBeforeSeqRpc, type ChatDeltaRow } from '@/src/lib/chat-supabase-delta';
import { isTransientNetworkErrorMessage } from '@/src/lib/supabase-realtime-resilience';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { OfflineChatRoomKey, OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey, roomKeyToString } from '@/src/lib/offline-chat/offline-chat-types';
import { buildSearchText, sanitizeUnicodeForSqliteStorage, tsToMs } from '@/src/lib/offline-chat/offline-chat-utils';
import { localRoomPreviewForMessage } from '@/src/lib/offline-chat/offline-chat-rooms';

/**
 * Firestore Read 비용 절감 핵심:
 * - (증분) createdAt > lastSyncedAt 이후만 가져오기
 * - (상한) 한번에 너무 많은 문서 pull 금지(페이지네이션)
 * - (Denormalize) senderName/avatar 등을 메시지에 같이 저장해 추가 read 방지
 */

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_DOCS = 1200;
const DEFAULT_MAX_PAGES_PER_RUN = 2;
const DEFAULT_TIME_BUDGET_MS = 1800;

function devLogOfflineChatSyncRpcFailure(rpcLabel: string, error: string): void {
  if (!__DEV__) return;
  if (isTransientNetworkErrorMessage(error)) {
    console.log(`[offline-chat-sync] ${rpcLabel} deferred (transient network)`);
    return;
  }
  console.warn(`[offline-chat-sync] ${rpcLabel}`, error);
}

export async function getOrCreateLocalRoom(key: OfflineChatRoomKey) {
  const db = database;
  if (!db) return null;
  const k = normalizeRoomKey(key);
  const rooms = db.get('chat_rooms');
  const existing = await rooms.query(Q.where('room_id', k.roomId), Q.where('room_type', k.roomType)).fetch();
  if (existing.length) return existing[0]!;
  return db.write(async () => {
    return rooms.create((r: any) => {
      r.roomId = k.roomId;
      r.roomType = k.roomType;
      r.ownerUserId = null;
      r.peerUserId = null;
      r.isGroup = k.roomType === 'meeting' ? true : false;
      r.lastSyncedAtMs = null;
      r.lastSyncedChangedAtMs = null;
      r.backfillCursorCreatedAtMs = null;
      r.lastPrunedAtMs = null;
      r.localMessageCount = null;
      r.lastMessageAtMs = null;
      r.lastMessageId = null;
      r.lastMessagePreview = null;
      r.lastMessageKind = null;
      r.lastSenderId = null;
      r.lastSenderName = null;
      r.lastSenderAvatarUrl = null;
      r.unreadCount = null;
      r.unreadLastAtMs = null;
      r.readMessageId = null;
      r.readAtMs = null;
      r.messageReadMessageIdByJson = null;
      r.messageReadAtByJson = null;
      r.messageReadStateLastAtMs = null;
      r.remoteUpdatedAtMs = null;
      r.roomSearchText = null;
      r.lastServerSeq = null;
      r.backfillBeforeServerSeq = null;
      r.lastReadServerSeq = null;
    });
  });
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    const j = JSON.stringify(value);
    return j ? sanitizeUnicodeForSqliteStorage(j) : null;
  } catch {
    return null;
  }
}

function sanitizeStoredText(s: string | null | undefined): string | null {
  if (s == null || typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  const out = sanitizeUnicodeForSqliteStorage(t);
  return out.trim() ? out.trim() : null;
}

function extractSenderDenorm(data: Record<string, unknown>): { senderName: string | null; senderAvatarUrl: string | null } {
  // 서버 스키마에 실제 필드가 없을 수 있어, 안전하게 읽고 없으면 null.
  const senderName = sanitizeStoredText(typeof data.senderName === 'string' ? data.senderName : null);
  const senderAvatarUrl = sanitizeStoredText(typeof data.senderAvatarUrl === 'string' ? data.senderAvatarUrl : null);
  return { senderName, senderAvatarUrl };
}

function mapServerMessageDocToLocal(args: {
  roomType: OfflineChatRoomType;
  roomId: string;
  messageId: string;
  data: Record<string, unknown>;
}): {
  roomId: string;
  roomType: OfflineChatRoomType;
  messageId: string;
  createdAtMs: number;
  senderId: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  kind: string | null;
  text: string | null;
  imageUrl: string | null;
  replyToMessageId: string | null;
  replyToJson: string | null;
  linkPreviewJson: string | null;
  rawPayloadJson: string | null;
  imageAlbumBatchId: string | null;
  searchText: string | null;
  isDeleted: boolean | null;
  deletedAtMs: number | null;
  updatedAtMs: number;
} {
  const { roomType, roomId, messageId, data } = args;
  const senderId = sanitizeStoredText(typeof data.senderId === 'string' ? data.senderId : null);
  const kindRaw = data.kind;
  const kind =
    kindRaw === 'image' || kindRaw === 'text' || kindRaw === 'system' ? (kindRaw as string) : typeof kindRaw === 'string' ? kindRaw : null;

  const text = sanitizeStoredText(typeof data.text === 'string' ? data.text : null);
  const imageUrl = sanitizeStoredText(typeof data.imageUrl === 'string' ? data.imageUrl : null);
  const imageAlbumBatchId = sanitizeStoredText(typeof data.imageAlbumBatchId === 'string' ? data.imageAlbumBatchId : null);
  const replyToMessageId =
    data.replyTo && typeof data.replyTo === 'object' && !Array.isArray(data.replyTo)
      ? sanitizeStoredText(
          typeof (data.replyTo as any).messageId === 'string' ? String((data.replyTo as any).messageId) : null,
        )
      : null;

  const createdAtMs = tsToMs(data.createdAt);
  const updatedAtMs = tsToMs(data.updatedAt) || createdAtMs;
  const deletedAtMs = tsToMs(data.deletedAt) || null;
  const { senderName, senderAvatarUrl } = extractSenderDenorm(data);
  const searchText = buildSearchText([text, kind === 'image' ? '사진' : '', senderName]);
  const isDeleted = deletedAtMs || Boolean((data as any).deletedAt) ? true : null;

  const messageIdSafe = sanitizeStoredText(messageId) ?? messageId.trim();
  return {
    roomId,
    roomType,
    messageId: messageIdSafe,
    createdAtMs,
    senderId,
    senderName,
    senderAvatarUrl,
    kind,
    text,
    imageUrl,
    imageAlbumBatchId,
    replyToMessageId,
    replyToJson: safeJson(data.replyTo),
    linkPreviewJson: safeJson(data.linkPreview),
    rawPayloadJson: safeJson(data),
    searchText,
    isDeleted,
    deletedAtMs,
    updatedAtMs,
  };
}

type LocalMessageUpsertRow = ReturnType<typeof mapServerMessageDocToLocal> & {
  serverSeq?: number | null;
  clientMutationId?: string | null;
};

function isoToMs(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Supabase `chat_pull_deltas` 행 → 로컬 upsert 행 (로컬 `room_id`는 항상 화면 키 `k.roomId` 유지) */
function mapSupabaseDeltaRowToLocal(k: OfflineChatRoomKey, row: ChatDeltaRow): LocalMessageUpsertRow {
  const messageId = sanitizeStoredText(String(row.id ?? '')) ?? String(row.id ?? '').trim();
  const createdAtMs = isoToMs(row.created_at);
  const updatedAtMs = isoToMs(row.updated_at ?? undefined) || createdAtMs;
  const deletedAtMs = row.deleted_at ? isoToMs(row.deleted_at) : null;
  const kindRaw = row.kind;
  const kind =
    kindRaw === 'image' || kindRaw === 'text' || kindRaw === 'system' ? kindRaw : typeof kindRaw === 'string' ? kindRaw : null;
  const text = sanitizeStoredText(typeof row.body_text === 'string' ? row.body_text : null);
  const imageUrl = sanitizeStoredText(typeof row.image_url === 'string' ? row.image_url : null);
  const imageAlbumBatchId = sanitizeStoredText(typeof row.image_album_batch_id === 'string' ? row.image_album_batch_id : null);
  const rt = row.reply_to;
  const replyToMessageId =
    rt && typeof rt === 'object' && !Array.isArray(rt)
      ? sanitizeStoredText(typeof (rt as Record<string, unknown>).messageId === 'string' ? String((rt as any).messageId) : null)
      : null;
  const senderId = sanitizeStoredText(typeof row.sender_app_user_id === 'string' ? row.sender_app_user_id : null);
  const searchText = buildSearchText([text, kind === 'image' ? '사진' : '', null]);
  const isDeleted = deletedAtMs && deletedAtMs > 0 ? true : null;
  const serverSeq =
    typeof row.seq === 'number' && Number.isFinite(row.seq) ? row.seq : Number.isFinite(Number(row.seq)) ? Number(row.seq) : null;
  return {
    roomId: k.roomId,
    roomType: k.roomType,
    messageId,
    createdAtMs,
    senderId,
    senderName: null,
    senderAvatarUrl: null,
    kind,
    text,
    imageUrl,
    imageAlbumBatchId,
    replyToMessageId,
    replyToJson: safeJson(rt),
    linkPreviewJson: safeJson(row.link_preview),
    rawPayloadJson: safeJson(row),
    searchText,
    isDeleted,
    deletedAtMs,
    updatedAtMs,
    serverSeq: serverSeq != null && Number.isFinite(serverSeq) && serverSeq > 0 ? serverSeq : null,
    clientMutationId: sanitizeStoredText(
      typeof row.client_mutation_id === 'string' ? row.client_mutation_id : null,
    ),
  };
}

export type IncrementalSyncArgs = {
  key: OfflineChatRoomKey;
  /** Supabase 델타(`EXPO_PUBLIC_CHAT_DELTA_TRANSPORT=supabase`)일 때 필수 — `app_user_id` PK */
  appUserId?: string | null;
  /** 로컬 커서가 없을 때, 최근 이 ms 이후만(초기 pull 상한) */
  initialSinceMs?: number;
  pageSize?: number;
  maxDocs?: number;
  /** 방 진입 직후 UI를 먼저 채우는 최신 메시지 블록 크기 */
  latestBlockSize?: number;
  /** 한 번의 foreground sync에서 처리할 최대 페이지 수 */
  maxPagesPerRun?: number;
  /** JS thread를 오래 점유하지 않기 위한 대략적인 시간 예산 */
  timeBudgetMs?: number;
};

export type OfflineChatLocalMessageInput = {
  messageId: string;
  createdAtMs: number;
  updatedAtMs?: number | null;
  deletedAtMs?: number | null;
  senderId?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  kind?: string | null;
  text?: string | null;
  imageUrl?: string | null;
  imageAlbumBatchId?: string | null;
  replyToMessageId?: string | null;
  replyToJson?: string | null;
  linkPreviewJson?: string | null;
  rawPayloadJson?: string | null;
  /** Supabase `chat_messages.seq` */
  serverSeq?: number | null;
  clientMutationId?: string | null;
};

function meetingCreatedTimeMs(v: MeetingChatMessage['createdAt'] | undefined | null): number {
  if (v == null) return 0;
  if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

/** 라이브 tail 등 `MeetingChatMessage[]` → `upsertLocalChatMessages` 입력 */
export function offlineInputsFromMeetingChatMessages(messages: readonly MeetingChatMessage[]): OfflineChatLocalMessageInput[] {
  return messages.map((m) => ({
    messageId: m.id,
    createdAtMs: meetingCreatedTimeMs(m.createdAt),
    updatedAtMs: meetingCreatedTimeMs(m.updatedAt) || meetingCreatedTimeMs(m.createdAt),
    deletedAtMs: meetingCreatedTimeMs(m.deletedAt) || null,
    senderId: m.senderId,
    senderName: m.senderName ?? null,
    senderAvatarUrl: m.senderAvatarUrl ?? null,
    kind: m.kind,
    text: m.text,
    imageUrl: m.imageUrl,
    imageAlbumBatchId: m.imageAlbumBatchId ?? null,
    replyToMessageId: m.replyTo?.messageId ?? null,
    replyToJson: m.replyTo ? JSON.stringify(m.replyTo) : null,
    linkPreviewJson: m.linkPreview ? JSON.stringify(m.linkPreview) : null,
    rawPayloadJson: null,
    serverSeq:
      typeof m.serverSeq === 'number' && Number.isFinite(m.serverSeq) && m.serverSeq > 0 ? Math.floor(m.serverSeq) : undefined,
    clientMutationId:
      typeof m.clientMutationId === 'string' && m.clientMutationId.trim() ? m.clientMutationId.trim() : undefined,
  }));
}

function dedupeLocalMessageUpsertRows(rows: LocalMessageUpsertRow[]): LocalMessageUpsertRow[] {
  const out = new Map<string, LocalMessageUpsertRow>();
  for (const r of rows) {
    const k = `${r.roomId}\u0000${r.roomType}\u0000${r.messageId}`;
    out.set(k, r);
  }
  return [...out.values()];
}

function applyLocalMessageUpsertToWriter(x: any, row: LocalMessageUpsertRow, roomFk: string | null) {
  x.messageId = row.messageId;
  x.createdAtMs = row.createdAtMs;
  x.updatedAtMs = row.updatedAtMs;
  x.deletedAtMs = row.deletedAtMs;
  x.senderId = row.senderId;
  x.senderName = row.senderName;
  x.senderAvatarUrl = row.senderAvatarUrl;
  x.kind = row.kind;
  x.text = row.text;
  x.imageUrl = row.imageUrl;
  x.imageAlbumBatchId = row.imageAlbumBatchId;
  x.replyToMessageId = row.replyToMessageId;
  x.replyToJson = row.replyToJson;
  x.linkPreviewJson = row.linkPreviewJson;
  x.rawPayloadJson = row.rawPayloadJson;
  x.searchText = row.searchText;
  x.isDeleted = row.isDeleted;
  if (typeof row.serverSeq === 'number' && Number.isFinite(row.serverSeq) && row.serverSeq > 0) {
    x.serverSeq = row.serverSeq;
  }
  if (roomFk) x.chatRoomId = roomFk;
  if (row.clientMutationId !== undefined) {
    x.clientMutationId = row.clientMutationId == null ? null : sanitizeStoredText(String(row.clientMutationId));
  }
}

async function upsertLocalMessageRows(
  db: typeof database,
  localRoom: unknown,
  rows: LocalMessageUpsertRow[],
): Promise<{ newestCreatedAtMs: number; newestUpdatedAtMs: number; newestMessageId: string | null }> {
  let newestCreatedAtMs = 0;
  let newestUpdatedAtMs = 0;
  let newestMessageId: string | null = null;
  let newestRow: LocalMessageUpsertRow | null = null;
  if (!db || rows.length === 0) return { newestCreatedAtMs, newestUpdatedAtMs, newestMessageId };

  const deduped = dedupeLocalMessageUpsertRows(rows);

  const roomFk =
    localRoom && typeof (localRoom as { id?: unknown }).id === 'string'
      ? String((localRoom as { id: string }).id)
      : null;

  let maxServerSeqInBatch = 0;
  for (const row of deduped) {
    const s = typeof row.serverSeq === 'number' && Number.isFinite(row.serverSeq) ? Math.floor(row.serverSeq) : 0;
    if (s > maxServerSeqInBatch) maxServerSeqInBatch = s;
    if (row.createdAtMs > newestCreatedAtMs) {
      newestCreatedAtMs = row.createdAtMs;
      newestMessageId = row.messageId;
      newestRow = row;
    }
    if (row.updatedAtMs > newestUpdatedAtMs) newestUpdatedAtMs = row.updatedAtMs;
  }

  const rid = deduped[0]!.roomId;
  const rtype = deduped[0]!.roomType;
  const msgs = db.get('chat_messages');

  const messageIds = [...new Set(deduped.map((r) => r.messageId).filter(Boolean))];
  const clientIdsRaw = deduped
    .map((r) => (r.clientMutationId ? sanitizeStoredText(String(r.clientMutationId)) : null))
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
  const clientIds = [...new Set(clientIdsRaw)];

  const byMessageId = new Map<string, any>();
  const byClientId = new Map<string, any>();
  if (messageIds.length > 0) {
    const found = await msgs
      .query(Q.where('room_id', rid), Q.where('room_type', rtype), Q.where('message_id', Q.oneOf(messageIds)))
      .fetch();
    for (const m of found) {
      const mid = typeof (m as any).messageId === 'string' ? (m as any).messageId.trim() : '';
      if (mid) byMessageId.set(mid, m);
    }
  }
  if (clientIds.length > 0) {
    const foundC = await msgs
      .query(Q.where('room_id', rid), Q.where('room_type', rtype), Q.where('client_mutation_id', Q.oneOf(clientIds)))
      .fetch();
    for (const m of foundC) {
      const cm = typeof (m as any).clientMutationId === 'string' ? (m as any).clientMutationId.trim() : '';
      if (cm) byClientId.set(cm, m);
    }
  }

  await db.write(async () => {
    const batchOps: any[] = [];
    for (const row of deduped) {
      let m = byMessageId.get(row.messageId);
      if (!m) {
        const cm = row.clientMutationId ? sanitizeStoredText(String(row.clientMutationId)) : '';
        if (cm) m = byClientId.get(cm);
      }
      if (m) {
        batchOps.push(
          m.prepareUpdate((x: any) => {
            applyLocalMessageUpsertToWriter(x, row, roomFk);
          }),
        );
      } else {
        batchOps.push(
          msgs.prepareCreate((x: any) => {
            x.roomId = row.roomId;
            x.roomType = row.roomType;
            applyLocalMessageUpsertToWriter(x, row, roomFk);
          }),
        );
      }
    }

    await db.batch(...batchOps);
    const count = await msgs.query(Q.where('room_id', rid), Q.where('room_type', rtype)).fetchCount();
    await (localRoom as any).update((r: any) => {
      const prevLastMs = typeof r.lastMessageAtMs === 'number' ? r.lastMessageAtMs : 0;
      if (newestCreatedAtMs > 0) r.lastMessageAtMs = Math.max(prevLastMs, newestCreatedAtMs);
      if (newestMessageId && newestRow && newestCreatedAtMs >= prevLastMs) {
        r.lastMessageId = newestMessageId;
        r.lastMessagePreview = localRoomPreviewForMessage(newestRow);
        r.lastMessageKind = newestRow.kind;
        r.lastSenderId = newestRow.senderId;
        r.lastSenderName = newestRow.senderName;
        r.lastSenderAvatarUrl = newestRow.senderAvatarUrl;
      }
      if (newestUpdatedAtMs > 0) r.remoteUpdatedAtMs = Math.max(r.remoteUpdatedAtMs ?? 0, newestUpdatedAtMs);
      r.localMessageCount = count;
      if (maxServerSeqInBatch > 0) {
        const cur = typeof r.lastServerSeq === 'number' && Number.isFinite(r.lastServerSeq) ? Math.floor(r.lastServerSeq) : 0;
        r.lastServerSeq = Math.max(cur, maxServerSeqInBatch);
      }
    });
  });

  return { newestCreatedAtMs, newestUpdatedAtMs, newestMessageId };
}

export async function upsertLocalChatMessages(
  key: OfflineChatRoomKey,
  messages: readonly OfflineChatLocalMessageInput[],
): Promise<void> {
  const db = database;
  if (!db || messages.length === 0) return;
  const k = normalizeRoomKey(key);
  if (!k.roomId) return;
  const localRoom = await getOrCreateLocalRoom(k);
  if (!localRoom) return;
  const rows = messages
    .map((m) => {
      const messageId = sanitizeStoredText(String(m.messageId ?? '')) ?? String(m.messageId ?? '').trim();
      const createdAtMs = typeof m.createdAtMs === 'number' && Number.isFinite(m.createdAtMs) ? m.createdAtMs : 0;
      if (!messageId || createdAtMs <= 0) return null;
      const kind = m.kind === 'image' || m.kind === 'text' || m.kind === 'system' ? m.kind : m.kind ?? null;
      const text = sanitizeStoredText(typeof m.text === 'string' ? m.text : null);
      const senderName = sanitizeStoredText(typeof m.senderName === 'string' ? m.senderName : null);
      return {
        roomId: k.roomId,
        roomType: k.roomType,
        messageId,
        createdAtMs,
        updatedAtMs:
          typeof m.updatedAtMs === 'number' && Number.isFinite(m.updatedAtMs) && m.updatedAtMs > 0
            ? m.updatedAtMs
            : createdAtMs,
        deletedAtMs:
          typeof m.deletedAtMs === 'number' && Number.isFinite(m.deletedAtMs) && m.deletedAtMs > 0 ? m.deletedAtMs : null,
        senderId: sanitizeStoredText(typeof m.senderId === 'string' ? m.senderId : null),
        senderName,
        senderAvatarUrl: sanitizeStoredText(typeof m.senderAvatarUrl === 'string' ? m.senderAvatarUrl : null),
        kind,
        text,
        imageUrl: sanitizeStoredText(typeof m.imageUrl === 'string' ? m.imageUrl : null),
        imageAlbumBatchId: sanitizeStoredText(typeof m.imageAlbumBatchId === 'string' ? m.imageAlbumBatchId : null),
        replyToMessageId: sanitizeStoredText(typeof m.replyToMessageId === 'string' ? m.replyToMessageId : null),
        replyToJson: m.replyToJson == null ? null : sanitizeStoredText(String(m.replyToJson)),
        linkPreviewJson: m.linkPreviewJson == null ? null : sanitizeStoredText(String(m.linkPreviewJson)),
        rawPayloadJson: m.rawPayloadJson == null ? null : sanitizeStoredText(String(m.rawPayloadJson)),
        searchText: buildSearchText([text, kind === 'image' ? '사진' : '', senderName]),
        isDeleted:
          typeof m.deletedAtMs === 'number' && Number.isFinite(m.deletedAtMs) && m.deletedAtMs > 0 ? true : null,
        serverSeq:
          typeof m.serverSeq === 'number' && Number.isFinite(m.serverSeq) && m.serverSeq > 0
            ? Math.floor(m.serverSeq)
            : null,
        clientMutationId: sanitizeStoredText(typeof m.clientMutationId === 'string' ? m.clientMutationId : null),
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  await upsertLocalMessageRows(db, localRoom, rows);
}

async function incrementalSyncFromSupabaseDeltas(
  args: IncrementalSyncArgs & { appUserId: string },
): Promise<{ pulledDocs: number; lastSyncedAtMs: number }> {
  const db = database;
  if (!db) return { pulledDocs: 0, lastSyncedAtMs: 0 };

  const k = normalizeRoomKey(args.key);
  const pageSize = Math.min(Math.max(50, args.pageSize ?? DEFAULT_PAGE_SIZE), 500);
  const maxDocs = Math.min(Math.max(200, args.maxDocs ?? DEFAULT_MAX_DOCS), 5000);
  const maxPagesPerRun = Math.min(Math.max(1, args.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN), 10);
  const timeBudgetMs = Math.min(Math.max(500, args.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS), 10_000);
  const startedAt = Date.now();

  const localRoom = await getOrCreateLocalRoom(k);
  if (!localRoom) return { pulledDocs: 0, lastSyncedAtMs: 0 };

  const roomKind = k.roomType === 'social_dm' ? 'social_dm' : 'meeting';
  let afterSeq = (() => {
    const v = (localRoom as { lastServerSeq?: number | null }).lastServerSeq;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  })();

  let pulled = 0;
  let pages = 0;
  let newestChangedSeenMs =
    ((localRoom as any).lastSyncedChangedAtMs as number | null | undefined) ??
    ((localRoom as any).lastSyncedAtMs as number | null | undefined) ??
    0;
  let accumulatedLastMessageMs = (() => {
    const v = (localRoom as any).lastMessageAtMs as number | null | undefined;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  })();

  while (pulled < maxDocs && pages < maxPagesPerRun && Date.now() - startedAt < timeBudgetMs) {
    const lim = Math.min(pageSize, maxDocs - pulled);
    const res = await chatPullDeltasRpc({
      meAppUserId: args.appUserId,
      roomKind,
      roomId: k.roomId,
      afterSeq,
      limit: lim,
    });
    if (res.error) {
      devLogOfflineChatSyncRpcFailure('chat_pull_deltas', res.error);
      break;
    }
    const rows = res.rows.map((r) => mapSupabaseDeltaRowToLocal(k, r));
    if (rows.length > 0) {
      const stats = await upsertLocalMessageRows(db, localRoom, rows);
      accumulatedLastMessageMs = Math.max(accumulatedLastMessageMs, stats.newestCreatedAtMs);
      newestChangedSeenMs = Math.max(newestChangedSeenMs, stats.newestUpdatedAtMs, Date.now());
    }
    pulled += rows.length;
    afterSeq = typeof res.max_seq === 'number' && Number.isFinite(res.max_seq) ? res.max_seq : afterSeq;
    pages += 1;

    await db.write(async () => {
      await (localRoom as any).update((r: any) => {
        r.lastServerSeq = afterSeq;
      });
    });

    if (!res.has_more) break;
    if (rows.length === 0) break;
  }

  const cursorWall = Math.max(0, args.initialSinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (pulled > 0 || afterSeq > 0) {
    await db.write(async () => {
      await (localRoom as any).update((r: any) => {
        r.lastSyncedAtMs = Math.max(r.lastSyncedAtMs ?? 0, accumulatedLastMessageMs, cursorWall);
        r.lastSyncedChangedAtMs = Math.max(r.lastSyncedChangedAtMs ?? 0, newestChangedSeenMs);
        if (accumulatedLastMessageMs > 0) r.lastMessageAtMs = Math.max(r.lastMessageAtMs ?? 0, accumulatedLastMessageMs);
      });
    });
  }

  if (accumulatedLastMessageMs <= 0) {
    const top = await db
      .get('chat_messages')
      .query(Q.where('room_id', k.roomId), Q.where('room_type', k.roomType), Q.sortBy('created_at_ms', Q.desc), Q.take(1))
      .fetch();
    const m0 = top[0] as { createdAtMs?: number } | undefined;
    const ms = typeof m0?.createdAtMs === 'number' && Number.isFinite(m0.createdAtMs) ? m0.createdAtMs : 0;
    if (ms > 0) {
      accumulatedLastMessageMs = ms;
      await db.write(async () => {
        await (localRoom as any).update((r: any) => {
          r.lastMessageAtMs = accumulatedLastMessageMs;
        });
      });
    }
  }

  return { pulledDocs: pulled, lastSyncedAtMs: Math.max(newestChangedSeenMs, afterSeq > 0 ? Date.now() : 0) };
}

export async function incrementalSyncRoomMessagesToLocal(args: IncrementalSyncArgs): Promise<{
  pulledDocs: number;
  lastSyncedAtMs: number;
}> {
  const db = database;
  if (!db) return { pulledDocs: 0, lastSyncedAtMs: 0 };

  const uid = args.appUserId?.trim();
  if (!uid) return { pulledDocs: 0, lastSyncedAtMs: 0 };
  return incrementalSyncFromSupabaseDeltas({ ...args, appUserId: uid });
}

export async function backfillOlderRoomMessagesToLocal(args: {
  key: OfflineChatRoomKey;
  /** Supabase 백필(`chat_pull_history_before_seq`)에 필수 */
  appUserId?: string | null;
  pageSize?: number;
  maxPages?: number;
  timeBudgetMs?: number;
}): Promise<{ pulledDocs: number; nextCursorCreatedAtMs: number | null }> {
  const db = database;
  if (!db) return { pulledDocs: 0, nextCursorCreatedAtMs: null };
  const k = normalizeRoomKey(args.key);
  if (!k.roomId) return { pulledDocs: 0, nextCursorCreatedAtMs: null };
  const localRoom = await getOrCreateLocalRoom(k);
  if (!localRoom) return { pulledDocs: 0, nextCursorCreatedAtMs: null };

  const uid = args.appUserId?.trim();
  if (!uid) {
    const c = (localRoom as any).backfillCursorCreatedAtMs as number | null | undefined;
    return {
      pulledDocs: 0,
      nextCursorCreatedAtMs: typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : null,
    };
  }
  const roomKind = k.roomType === 'social_dm' ? 'social_dm' : 'meeting';
  const pageSize = Math.min(Math.max(20, args.pageSize ?? 100), 200);
  const maxPages = Math.min(Math.max(1, args.maxPages ?? 1), 5);
  const timeBudgetMs = Math.min(Math.max(300, args.timeBudgetMs ?? 900), 5000);
  const startedAt = Date.now();
  const msgsTable = db.get('chat_messages');

  const lastSrv = (() => {
    const v = (localRoom as { lastServerSeq?: number | null }).lastServerSeq;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  })();

  let beforeSeq = (() => {
    const v = (localRoom as { backfillBeforeServerSeq?: number | null }).backfillBeforeServerSeq;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  })();

  if (beforeSeq <= 0) {
    const withSeq = await msgsTable
      .query(
        Q.where('room_id', k.roomId),
        Q.where('room_type', k.roomType),
        Q.where('server_seq', Q.gt(0)),
        Q.sortBy('server_seq', Q.asc),
        Q.take(1),
      )
      .fetch();
    const minLocal = (withSeq[0] as { serverSeq?: number } | undefined)?.serverSeq;
    if (typeof minLocal === 'number' && Number.isFinite(minLocal) && minLocal > 0) {
      beforeSeq = minLocal;
    } else if (lastSrv > 0) {
      beforeSeq = lastSrv + 1;
    } else {
      const c = (localRoom as any).backfillCursorCreatedAtMs as number | null | undefined;
      return {
        pulledDocs: 0,
        nextCursorCreatedAtMs: typeof c === 'number' && Number.isFinite(c) && c > 0 ? c : null,
      };
    }
  }

  let pulled = 0;
  let nextCursorMs: number | null = null;
  let pages = 0;
  while (pages < maxPages && Date.now() - startedAt < timeBudgetMs) {
    const res = await chatPullHistoryBeforeSeqRpc({
      meAppUserId: uid,
      roomKind,
      roomId: k.roomId,
      beforeSeq,
      limit: pageSize,
    });
    if (res.error) {
      devLogOfflineChatSyncRpcFailure('chat_pull_history_before_seq', res.error);
      break;
    }
    const rows = res.rows.map((r) => mapSupabaseDeltaRowToLocal(k, r));
    if (rows.length > 0) {
      await upsertLocalMessageRows(db, localRoom, rows);
      pulled += rows.length;
      const oldest = rows[rows.length - 1];
      if (oldest?.createdAtMs) nextCursorMs = oldest.createdAtMs;
    }
    const seqs = rows
      .map((r) => (typeof r.serverSeq === 'number' && Number.isFinite(r.serverSeq) ? r.serverSeq : NaN))
      .filter((n) => Number.isFinite(n) && n > 0);
    const minFromRows = seqs.length > 0 ? Math.min(...seqs) : null;
    const minSeq =
      typeof res.min_seq === 'number' && Number.isFinite(res.min_seq) && res.min_seq > 0
        ? res.min_seq
        : minFromRows != null && Number.isFinite(minFromRows)
          ? minFromRows
          : null;

    pages += 1;
    if (!res.has_more || rows.length === 0) {
      await db.write(async () => {
        await (localRoom as any).update((r: any) => {
          r.backfillBeforeServerSeq = null;
          if (nextCursorMs != null) r.backfillCursorCreatedAtMs = nextCursorMs;
        });
      });
      break;
    }
    if (minSeq != null && minSeq < beforeSeq) {
      beforeSeq = minSeq;
      await db.write(async () => {
        await (localRoom as any).update((r: any) => {
          r.backfillBeforeServerSeq = minSeq;
          if (nextCursorMs != null) r.backfillCursorCreatedAtMs = nextCursorMs;
        });
      });
    } else {
      await db.write(async () => {
        await (localRoom as any).update((r: any) => {
          r.backfillBeforeServerSeq = null;
          if (nextCursorMs != null) r.backfillCursorCreatedAtMs = nextCursorMs;
        });
      });
      break;
    }
    if (rows.length < pageSize && !res.has_more) break;
  }

  return { pulledDocs: pulled, nextCursorCreatedAtMs: nextCursorMs };
}

/**
 * (개념) Firestore Search Index Chunk 조회 → 로컬 chunk 캐시 저장.
 *
 * 서버 구조 제안:
 * - collection: `chat_search_index_chunks`
 * - docId: `${roomType}:${roomId}:${chunkId}`
 * - fields: { roomType, roomId, chunkId, rangeStartAt, rangeEndAt, chunkText }
 *
 * 비용 포인트:
 * - 검색 시에만 "최소 chunk"를 읽고, 결과가 없다면 더 과거 chunk를 추가로 읽는 방식(상한 필요)
 */
export async function backfillSearchIndexChunksBestEffort(args: {
  key: OfflineChatRoomKey;
  /** 예: '2026-05-01_0' 같은 서버 chunk id들(최근 -> 과거 순) */
  chunkIds: string[];
}): Promise<{ stored: number }> {
  const db = database;
  if (!db) return { stored: 0 };
  const k = normalizeRoomKey(args.key);
  if (!k.roomId) return { stored: 0 };

  // TODO: 실제 Firestore chunk 컬렉션/필드가 정의되면 여기서 getDocs/getDoc로 가져옵니다.
  // 현재는 "설계/구현 자리"만 마련하고, 서버 스키마 확정 후 연결합니다.

  let stored = 0;
  await db.write(async () => {
    const chunks = db.get('chat_search_index_chunks');
    for (const cid of args.chunkIds) {
      const id = String(cid ?? '').trim();
      if (!id) continue;
      const existing = await chunks.query(
        Q.where('room_id', k.roomId),
        Q.where('room_type', k.roomType),
        Q.where('chunk_id', id),
      ).fetch();
      if (existing.length) continue;
      await chunks.create((x: any) => {
        x.roomId = k.roomId;
        x.roomType = k.roomType;
        x.chunkId = id;
        x.rangeStartAtMs = null;
        x.rangeEndAtMs = null;
        x.chunkText = '';
        x.fetchedAtMs = Date.now();
      });
      stored++;
    }
  });

  return { stored };
}

export function getOfflineCostGuide(): string {
  return [
    'Firestore Read 비용 절감을 위해, 로컬 DB가 "진실의 원본"이 되도록 설계합니다.',
    '- 증분 동기화: createdAt > lastSyncedAt 조건 + 페이지 상한',
    '- Denormalize: senderName/avatar 등은 메시지에 포함해 프로필 조회 read 차단',
    '- 검색: 로컬 FTS/LIKE로 해결하고, 부족할 때만 server index chunk를 온디맨드로 backfill',
  ].join('\n');
}

