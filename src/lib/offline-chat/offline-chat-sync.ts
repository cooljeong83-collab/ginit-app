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
} from 'firebase/firestore';

import { database } from '@/src/watermelon';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { CHAT_ROOMS_COLLECTION, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION } from '@/src/lib/social-chat-rooms';
import { MEETING_MESSAGES_SUBCOLLECTION } from '@/src/lib/meeting-chat';
import { MEETINGS_COLLECTION } from '@/src/lib/meetings';
import type { OfflineChatRoomKey, OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey, roomKeyToString } from '@/src/lib/offline-chat/offline-chat-types';
import { buildSearchText, tsToMs } from '@/src/lib/offline-chat/offline-chat-utils';

/**
 * Firestore Read 비용 절감 핵심:
 * - (증분) createdAt > lastSyncedAt 이후만 가져오기
 * - (상한) 한번에 너무 많은 문서 pull 금지(페이지네이션)
 * - (Denormalize) senderName/avatar 등을 메시지에 같이 저장해 추가 read 방지
 */

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_DOCS = 1200;

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
      r.peerUserId = null;
      r.lastSyncedAtMs = null;
      r.lastMessageAtMs = null;
      r.lastMessageId = null;
    });
  });
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
  searchText: string | null;
  isDeleted: boolean | null;
} {
  const { roomType, roomId, messageId, data } = args;
  const senderId = typeof data.senderId === 'string' && data.senderId.trim() ? data.senderId.trim() : null;
  const kindRaw = data.kind;
  const kind =
    kindRaw === 'image' || kindRaw === 'text' || kindRaw === 'system' ? (kindRaw as string) : typeof kindRaw === 'string' ? kindRaw : null;

  const text = typeof data.text === 'string' ? data.text : null;
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : null;
  const replyToMessageId =
    data.replyTo && typeof data.replyTo === 'object' && !Array.isArray(data.replyTo)
      ? (typeof (data.replyTo as any).messageId === 'string' ? String((data.replyTo as any).messageId).trim() : null)
      : null;

  const createdAtMs = tsToMs(data.createdAt);
  const { senderName, senderAvatarUrl } = extractSenderDenorm(data);
  const searchText = buildSearchText([text, kind === 'image' ? '사진' : '', senderName]);
  const isDeleted = Boolean((data as any).deletedAt) ? true : null;

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
    replyToMessageId,
    searchText,
    isDeleted,
  };
}

export type IncrementalSyncArgs = {
  key: OfflineChatRoomKey;
  /** 로컬 커서가 없을 때, 최근 이 ms 이후만(초기 pull 상한) */
  initialSinceMs?: number;
  pageSize?: number;
  maxDocs?: number;
};

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

  const localRoom = await getOrCreateLocalRoom(k);
  if (!localRoom) return { pulledDocs: 0, lastSyncedAtMs: 0 };

  const existingCursorMs = (localRoom as any).lastSyncedAtMs as number | null | undefined;
  const cursorMs =
    typeof existingCursorMs === 'number' && Number.isFinite(existingCursorMs) && existingCursorMs > 0
      ? existingCursorMs
      : Math.max(0, args.initialSinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000);

  let pulled = 0;
  let lastSnap: DocumentSnapshot | undefined;
  let newestSeenMs = cursorMs;

  while (pulled < maxDocs) {
    const cref = roomMessagesCollectionRef(k.roomType, k.roomId);
    const base = query(
      cref,
      orderBy('createdAt', 'asc'),
      where('createdAt', '>', Timestamp.fromMillis(cursorMs)),
      ...(lastSnap ? [startAfter(lastSnap)] : []),
      limit(pageSize),
    );
    const snap = await getDocs(base);
    if (snap.empty) break;

    const batchRows = snap.docs.map((d) => mapFirestoreMessageToLocal({ roomType: k.roomType, roomId: k.roomId, messageId: d.id, data: d.data() as any }));
    pulled += batchRows.length;

    // 로컬 upsert: message_id 기준으로 있으면 update, 없으면 create
    await db.write(async () => {
      const msgs = db.get('chat_messages');
      for (const row of batchRows) {
        const existing = await msgs.query(
          Q.where('room_id', row.roomId),
          Q.where('room_type', row.roomType),
          Q.where('message_id', row.messageId),
        ).fetch();
        const m = existing[0];
        if (m) {
          await m.update((x: any) => {
            x.createdAtMs = row.createdAtMs;
            x.senderId = row.senderId;
            x.senderName = row.senderName;
            x.senderAvatarUrl = row.senderAvatarUrl;
            x.kind = row.kind;
            x.text = row.text;
            x.imageUrl = row.imageUrl;
            x.replyToMessageId = row.replyToMessageId;
            x.searchText = row.searchText;
            x.isDeleted = row.isDeleted;
          });
        } else {
          await msgs.create((x: any) => {
            x.roomId = row.roomId;
            x.roomType = row.roomType;
            x.messageId = row.messageId;
            x.createdAtMs = row.createdAtMs;
            x.senderId = row.senderId;
            x.senderName = row.senderName;
            x.senderAvatarUrl = row.senderAvatarUrl;
            x.kind = row.kind;
            x.text = row.text;
            x.imageUrl = row.imageUrl;
            x.replyToMessageId = row.replyToMessageId;
            x.searchText = row.searchText;
            x.isDeleted = row.isDeleted;
          });
        }
        if (row.createdAtMs > newestSeenMs) newestSeenMs = row.createdAtMs;
      }
      await (localRoom as any).update((r: any) => {
        r.lastSyncedAtMs = newestSeenMs;
      });
    });

    lastSnap = snap.docs[snap.docs.length - 1]!;
    if (snap.size < pageSize) break;
  }

  return { pulledDocs: pulled, lastSyncedAtMs: newestSeenMs };
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

