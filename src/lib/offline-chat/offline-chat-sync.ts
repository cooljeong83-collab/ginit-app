import { Q } from '@nozbe/watermelondb';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { database } from '@/src/watermelon';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { CHAT_ROOMS_COLLECTION, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION } from '@/src/lib/social-chat-rooms';
import { MEETING_MESSAGES_SUBCOLLECTION } from '@/src/lib/meeting-chat';
import { MEETINGS_COLLECTION } from '@/src/lib/meetings';
import type { OfflineChatRoomKey, OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey, roomKeyToString } from '@/src/lib/offline-chat/offline-chat-types';
import { buildSearchText, tsToMs } from '@/src/lib/offline-chat/offline-chat-utils';
import { localRoomPreviewForMessage } from '@/src/lib/offline-chat/offline-chat-rooms';

/**
 * Firestore Read 비용 절감 핵심:
 * - (증분) createdAt > lastSyncedAt 이후만 가져오기
 * - (상한) 한번에 너무 많은 문서 pull 금지(페이지네이션)
 * - (Denormalize) senderName/avatar 등을 메시지에 같이 저장해 추가 read 방지
 */

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_DOCS = 1200;
const DEFAULT_LATEST_BLOCK_SIZE = 80;
const DEFAULT_MAX_PAGES_PER_RUN = 2;
const DEFAULT_TIME_BUDGET_MS = 1800;

function roomMessagesCollectionRef(roomType: OfflineChatRoomType, roomId: string) {
  const db = getFirebaseFirestore();
  if (roomType === 'meeting') {
    return collection(db, MEETINGS_COLLECTION, roomId, MEETING_MESSAGES_SUBCOLLECTION);
  }
  return collection(db, CHAT_ROOMS_COLLECTION, roomId, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);
}

async function getOrCreateLocalRoom(key: OfflineChatRoomKey) {
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
    });
  });
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractSenderDenorm(data: Record<string, unknown>): { senderName: string | null; senderAvatarUrl: string | null } {
  // 서버 스키마에 실제 필드가 없을 수 있어, 안전하게 읽고 없으면 null.
  const senderName = typeof data.senderName === 'string' && data.senderName.trim() ? data.senderName.trim() : null;
  const senderAvatarUrl =
    typeof data.senderAvatarUrl === 'string' && data.senderAvatarUrl.trim() ? data.senderAvatarUrl.trim() : null;
  return { senderName, senderAvatarUrl };
}

function mapFirestoreMessageToLocal(args: {
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
  const senderId = typeof data.senderId === 'string' && data.senderId.trim() ? data.senderId.trim() : null;
  const kindRaw = data.kind;
  const kind =
    kindRaw === 'image' || kindRaw === 'text' || kindRaw === 'system' ? (kindRaw as string) : typeof kindRaw === 'string' ? kindRaw : null;

  const text = typeof data.text === 'string' ? data.text : null;
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : null;
  const imageAlbumBatchId =
    typeof data.imageAlbumBatchId === 'string' && data.imageAlbumBatchId.trim() ? data.imageAlbumBatchId.trim() : null;
  const replyToMessageId =
    data.replyTo && typeof data.replyTo === 'object' && !Array.isArray(data.replyTo)
      ? (typeof (data.replyTo as any).messageId === 'string' ? String((data.replyTo as any).messageId).trim() : null)
      : null;

  const createdAtMs = tsToMs(data.createdAt);
  const updatedAtMs = tsToMs(data.updatedAt) || createdAtMs;
  const deletedAtMs = tsToMs(data.deletedAt) || null;
  const { senderName, senderAvatarUrl } = extractSenderDenorm(data);
  const searchText = buildSearchText([text, kind === 'image' ? '사진' : '', senderName]);
  const isDeleted = deletedAtMs || Boolean((data as any).deletedAt) ? true : null;

  return {
    roomId,
    roomType,
    messageId,
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

export type IncrementalSyncArgs = {
  key: OfflineChatRoomKey;
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
};

async function upsertLocalMessageRows(
  db: typeof database,
  localRoom: unknown,
  rows: ReturnType<typeof mapFirestoreMessageToLocal>[],
): Promise<{ newestCreatedAtMs: number; newestUpdatedAtMs: number; newestMessageId: string | null }> {
  let newestCreatedAtMs = 0;
  let newestUpdatedAtMs = 0;
  let newestMessageId: string | null = null;
  let newestRow: ReturnType<typeof mapFirestoreMessageToLocal> | null = null;
  if (!db || rows.length === 0) return { newestCreatedAtMs, newestUpdatedAtMs, newestMessageId };

  await db.write(async () => {
    const msgs = db.get('chat_messages');
    for (const row of rows) {
      if (row.createdAtMs > newestCreatedAtMs) {
        newestCreatedAtMs = row.createdAtMs;
        newestMessageId = row.messageId;
        newestRow = row;
      }
      if (row.updatedAtMs > newestUpdatedAtMs) newestUpdatedAtMs = row.updatedAtMs;
      const existing = await msgs.query(
        Q.where('room_id', row.roomId),
        Q.where('room_type', row.roomType),
        Q.where('message_id', row.messageId),
      ).fetch();
      const m = existing[0];
      if (m) {
        await m.update((x: any) => {
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
        });
      } else {
        await msgs.create((x: any) => {
          x.roomId = row.roomId;
          x.roomType = row.roomType;
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
        });
      }
    }
    const count = await db
      .get('chat_messages')
      .query(Q.where('room_id', rows[0]!.roomId), Q.where('room_type', rows[0]!.roomType))
      .fetchCount();
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
    });
  });

  return { newestCreatedAtMs, newestUpdatedAtMs, newestMessageId };
}

function mapSnapRows(k: OfflineChatRoomKey, docs: QueryDocumentSnapshot[]) {
  return docs.map((d) =>
    mapFirestoreMessageToLocal({ roomType: k.roomType, roomId: k.roomId, messageId: d.id, data: d.data() as any }),
  );
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
      const messageId = String(m.messageId ?? '').trim();
      const createdAtMs = typeof m.createdAtMs === 'number' && Number.isFinite(m.createdAtMs) ? m.createdAtMs : 0;
      if (!messageId || createdAtMs <= 0) return null;
      const kind = m.kind === 'image' || m.kind === 'text' || m.kind === 'system' ? m.kind : m.kind ?? null;
      const text = typeof m.text === 'string' ? m.text : null;
      const senderName = typeof m.senderName === 'string' && m.senderName.trim() ? m.senderName.trim() : null;
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
        senderId: typeof m.senderId === 'string' && m.senderId.trim() ? m.senderId.trim() : null,
        senderName,
        senderAvatarUrl: typeof m.senderAvatarUrl === 'string' && m.senderAvatarUrl.trim() ? m.senderAvatarUrl.trim() : null,
        kind,
        text,
        imageUrl: typeof m.imageUrl === 'string' && m.imageUrl.trim() ? m.imageUrl.trim() : null,
        imageAlbumBatchId:
          typeof m.imageAlbumBatchId === 'string' && m.imageAlbumBatchId.trim() ? m.imageAlbumBatchId.trim() : null,
        replyToMessageId: typeof m.replyToMessageId === 'string' && m.replyToMessageId.trim() ? m.replyToMessageId.trim() : null,
        replyToJson: m.replyToJson ?? null,
        linkPreviewJson: m.linkPreviewJson ?? null,
        rawPayloadJson: m.rawPayloadJson ?? null,
        searchText: buildSearchText([text, kind === 'image' ? '사진' : '', senderName]),
        isDeleted:
          typeof m.deletedAtMs === 'number' && Number.isFinite(m.deletedAtMs) && m.deletedAtMs > 0 ? true : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  await upsertLocalMessageRows(db, localRoom, rows);
}

export async function incrementalSyncRoomMessagesToLocal(args: IncrementalSyncArgs): Promise<{
  pulledDocs: number;
  lastSyncedAtMs: number;
}> {
  const db = database;
  if (!db) return { pulledDocs: 0, lastSyncedAtMs: 0 };

  const { key } = args;
  const k = normalizeRoomKey(key);
  const pageSize = Math.min(Math.max(50, args.pageSize ?? DEFAULT_PAGE_SIZE), 500);
  const maxDocs = Math.min(Math.max(200, args.maxDocs ?? DEFAULT_MAX_DOCS), 5000);
  const latestBlockSize = Math.min(Math.max(20, args.latestBlockSize ?? DEFAULT_LATEST_BLOCK_SIZE), 200);
  const maxPagesPerRun = Math.min(Math.max(1, args.maxPagesPerRun ?? DEFAULT_MAX_PAGES_PER_RUN), 10);
  const timeBudgetMs = Math.min(Math.max(500, args.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS), 10_000);
  const startedAt = Date.now();

  const localRoom = await getOrCreateLocalRoom(k);
  if (!localRoom) return { pulledDocs: 0, lastSyncedAtMs: 0 };

  /** Direct Share 등에서 최근 방 정렬용 — 메시지 동기화 시마다 최신 createdAt 기준으로 갱신 */
  let accumulatedLastMessageMs = (() => {
    const v = (localRoom as any).lastMessageAtMs as number | null | undefined;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  })();

  const existingChangedCursorMs =
    ((localRoom as any).lastSyncedChangedAtMs as number | null | undefined) ??
    ((localRoom as any).lastSyncedAtMs as number | null | undefined);
  const cursorMs =
    typeof existingChangedCursorMs === 'number' && Number.isFinite(existingChangedCursorMs) && existingChangedCursorMs > 0
      ? existingChangedCursorMs
      : Math.max(0, args.initialSinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000);

  let pulled = 0;
  let lastSnap: DocumentSnapshot | undefined;
  let newestSeenMs = cursorMs;
  let newestChangedSeenMs = cursorMs;

  const cref = roomMessagesCollectionRef(k.roomType, k.roomId);

  // 1) UI critical path: latest block by display order. This also covers legacy docs without updatedAt.
  const latestSnap = await getDocs(query(cref, orderBy('createdAt', 'desc'), limit(latestBlockSize)));
  if (!latestSnap.empty) {
    const latestRows = mapSnapRows(k, latestSnap.docs);
    pulled += latestRows.length;
    const stats = await upsertLocalMessageRows(db, localRoom, latestRows);
    accumulatedLastMessageMs = Math.max(accumulatedLastMessageMs, stats.newestCreatedAtMs);
    const oldest = latestRows[latestRows.length - 1];
    await db.write(async () => {
      await (localRoom as any).update((r: any) => {
        if (oldest?.createdAtMs) r.backfillCursorCreatedAtMs = oldest.createdAtMs;
      });
    });
  }

  // 2) Changed cursor sync: bounded pages so a long absence never blocks first render.
  let pages = 0;
  while (pulled < maxDocs && pages < maxPagesPerRun && Date.now() - startedAt < timeBudgetMs) {
    const base = query(
      cref,
      orderBy('updatedAt', 'asc'),
      where('updatedAt', '>', Timestamp.fromMillis(cursorMs)),
      ...(lastSnap ? [startAfter(lastSnap)] : []),
      limit(pageSize),
    );
    const snap = await getDocs(base);
    if (snap.empty) break;
    pages += 1;

    const batchRows = mapSnapRows(k, snap.docs);
    pulled += batchRows.length;

    let batchMaxCreatedMs = 0;
    let batchMaxUpdatedMs = 0;
    for (const row of batchRows) {
      if (row.createdAtMs > batchMaxCreatedMs) batchMaxCreatedMs = row.createdAtMs;
      if (row.updatedAtMs > batchMaxUpdatedMs) batchMaxUpdatedMs = row.updatedAtMs;
    }
    accumulatedLastMessageMs = Math.max(accumulatedLastMessageMs, batchMaxCreatedMs);
    newestChangedSeenMs = Math.max(newestChangedSeenMs, batchMaxUpdatedMs);
    await upsertLocalMessageRows(db, localRoom, batchRows);

    lastSnap = snap.docs[snap.docs.length - 1]!;
    if (snap.size < pageSize) break;
  }

  if (pulled > 0 || newestChangedSeenMs > cursorMs) {
    await db.write(async () => {
      await (localRoom as any).update((r: any) => {
        r.lastSyncedAtMs = Math.max(r.lastSyncedAtMs ?? 0, accumulatedLastMessageMs, newestSeenMs);
        r.lastSyncedChangedAtMs = Math.max(r.lastSyncedChangedAtMs ?? 0, newestChangedSeenMs);
        if (accumulatedLastMessageMs > 0) r.lastMessageAtMs = accumulatedLastMessageMs;
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

  return { pulledDocs: pulled, lastSyncedAtMs: Math.max(newestChangedSeenMs, newestSeenMs) };
}

export async function backfillOlderRoomMessagesToLocal(args: {
  key: OfflineChatRoomKey;
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

  const pageSize = Math.min(Math.max(20, args.pageSize ?? 100), 300);
  const maxPages = Math.min(Math.max(1, args.maxPages ?? 1), 5);
  const timeBudgetMs = Math.min(Math.max(300, args.timeBudgetMs ?? 900), 5000);
  const startedAt = Date.now();
  let cursorMs = (localRoom as any).backfillCursorCreatedAtMs as number | null | undefined;
  if (typeof cursorMs !== 'number' || !Number.isFinite(cursorMs) || cursorMs <= 0) {
    const oldest = await db
      .get('chat_messages')
      .query(Q.where('room_id', k.roomId), Q.where('room_type', k.roomType), Q.sortBy('created_at_ms', Q.asc), Q.take(1))
      .fetch();
    cursorMs = (oldest[0] as any)?.createdAtMs ?? 0;
  }
  if (!cursorMs) return { pulledDocs: 0, nextCursorCreatedAtMs: null };

  const cref = roomMessagesCollectionRef(k.roomType, k.roomId);
  let pulled = 0;
  let nextCursor = cursorMs;
  for (let page = 0; page < maxPages && Date.now() - startedAt < timeBudgetMs; page += 1) {
    const snap = await getDocs(
      query(cref, orderBy('createdAt', 'desc'), where('createdAt', '<', Timestamp.fromMillis(nextCursor)), limit(pageSize)),
    );
    if (snap.empty) break;
    const rows = mapSnapRows(k, snap.docs);
    pulled += rows.length;
    await upsertLocalMessageRows(db, localRoom, rows);
    const oldest = rows[rows.length - 1];
    if (!oldest?.createdAtMs || oldest.createdAtMs >= nextCursor) break;
    nextCursor = oldest.createdAtMs;
    if (snap.size < pageSize) break;
  }

  if (pulled > 0) {
    await db.write(async () => {
      await (localRoom as any).update((r: any) => {
        r.backfillCursorCreatedAtMs = nextCursor;
      });
    });
  }

  return { pulledDocs: pulled, nextCursorCreatedAtMs: pulled > 0 ? nextCursor : cursorMs };
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

