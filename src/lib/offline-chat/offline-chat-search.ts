import { Q } from '@nozbe/watermelondb';

import { database } from '@/src/watermelon';
import type { OfflineChatRoomKey, OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { unsafeFtsSearchSnippets } from '@/src/watermelon/fts';

export type OfflineChatSearchRow = {
  roomType: OfflineChatRoomType;
  roomId: string;
  messageId: string;
  createdAtMs: number;
  senderName: string | null;
  text: string | null;
  /** FTS snippet ( [[hit]] markers included ) */
  snippet?: string | null;
  kind: string | null;
};

function normalizeNeedle(q: string): string {
  return String(q ?? '').trim().toLowerCase();
}

/**
 * 방 내 검색 (로컬 only).
 * - WatermelonDB는 기본적으로 LIKE 기반 조건을 제공하고, isIndexed 컬럼에 대해 SQLite index를 활용합니다.
 * - 더 극단적인 성능이 필요하면 search_text를 FTS 테이블로 미러링하는 방식(추후)을 붙이면 됩니다.
 */
export async function searchInRoomLocal(args: {
  key: OfflineChatRoomKey;
  query: string;
  limit?: number;
}): Promise<OfflineChatSearchRow[]> {
  const db = database;
  if (!db) return [];
  const k = normalizeRoomKey(args.key);
  const needle = normalizeNeedle(args.query);
  if (!k.roomId || !needle) return [];

  const lim = Math.min(Math.max(5, args.limit ?? 50), 200);
  const msgs = db.get('chat_messages');

  // FTS 우선(가능한 환경에서만). 실패 시 LIKE로 폴백.
  const snips = await unsafeFtsSearchSnippets({ roomType: k.roomType, roomId: k.roomId, needle, limit: lim }).catch(
    () => [],
  );
  if (snips.length) {
    const messageIds = snips
      .map((x) => x.messageKey.split(':').slice(2).join(':'))
      .map((s) => s.trim())
      .filter(Boolean);
    if (messageIds.length) {
      const ftsRows = await msgs
        .query(
          Q.where('room_id', k.roomId),
          Q.where('room_type', k.roomType),
          Q.where('message_id', Q.oneOf(messageIds)),
          Q.sortBy('created_at_ms', Q.desc),
          Q.take(lim),
        )
        .fetch();
      const snippetById = new Map<string, string>();
      for (const x of snips) {
        const mid = x.messageKey.split(':').slice(2).join(':').trim();
        if (mid && !snippetById.has(mid)) snippetById.set(mid, x.snippet);
      }
      return ftsRows.map((m: any) => ({
        roomType: m.roomType,
        roomId: m.roomId,
        messageId: m.messageId,
        createdAtMs: m.createdAtMs,
        senderName: m.senderName ?? null,
        text: m.text ?? null,
        snippet: snippetById.get(m.messageId) ?? null,
        kind: m.kind ?? null,
      }));
    }
  }

  const rows = await msgs
    .query(
      Q.where('room_id', k.roomId),
      Q.where('room_type', k.roomType),
      // case-insensitive LIKE를 위해 search_text는 lower()로 저장되는 것을 권장.
      Q.where('search_text', Q.like(`%${needle}%`)),
      Q.sortBy('created_at_ms', Q.desc),
      Q.take(lim),
    )
    .fetch();

  return rows.map((m: any) => ({
    roomType: m.roomType,
    roomId: m.roomId,
    messageId: m.messageId,
    createdAtMs: m.createdAtMs,
    senderName: m.senderName ?? null,
    text: m.text ?? null,
    kind: m.kind ?? null,
  }));
}

/** 방 내 로컬 검색 결과의 message_id만, 최신순(내림차순)으로 반환 */
export async function listLocalSearchMessageIdsNewestFirst(args: {
  key: OfflineChatRoomKey;
  query: string;
  limit?: number;
}): Promise<string[]> {
  const rows = await searchInRoomLocal({ key: args.key, query: args.query, limit: args.limit ?? 200 });
  return rows.map((r) => String(r.messageId ?? '').trim()).filter(Boolean);
}

/**
 * 전체 채팅방 검색 (로컬 only).
 * - 방 id/type 필터 없이 search_text만으로 찾되, 최신순 정렬.
 */
export async function searchAllRoomsLocal(args: { query: string; limit?: number }): Promise<OfflineChatSearchRow[]> {
  const db = database;
  if (!db) return [];
  const needle = normalizeNeedle(args.query);
  if (!needle) return [];
  const lim = Math.min(Math.max(5, args.limit ?? 80), 300);

  const msgs = db.get('chat_messages');

  const snips = await unsafeFtsSearchSnippets({ needle, limit: lim }).catch(() => []);
  if (snips.length) {
    const pairs = snips
      .map((x) => {
        const [roomType, roomId, ...rest] = x.messageKey.split(':');
        const messageId = rest.join(':');
        return { roomType: String(roomType ?? '').trim(), roomId: String(roomId ?? '').trim(), messageId: String(messageId ?? '').trim() };
      })
      .filter((x) => x.roomType && x.roomId && x.messageId);

    if (pairs.length) {
      const messageIds = Array.from(new Set(pairs.map((p) => p.messageId))).slice(0, lim);
      const ftsRows = await msgs
        .query(Q.where('message_id', Q.oneOf(messageIds)), Q.sortBy('created_at_ms', Q.desc), Q.take(lim))
        .fetch();
      const snippetByKey = new Map<string, string>();
      for (const x of snips) {
        if (!snippetByKey.has(x.messageKey)) snippetByKey.set(x.messageKey, x.snippet);
      }
      return ftsRows
        .map((m: any) => ({
          roomType: m.roomType,
          roomId: m.roomId,
          messageId: m.messageId,
          createdAtMs: m.createdAtMs,
          senderName: m.senderName ?? null,
          text: m.text ?? null,
          snippet: snippetByKey.get(`${m.roomType}:${m.roomId}:${m.messageId}`) ?? null,
          kind: m.kind ?? null,
        }))
        .filter((r) => pairs.some((p) => p.roomType === r.roomType && p.roomId === r.roomId && p.messageId === r.messageId));
    }
  }

  const rows = await msgs
    .query(Q.where('search_text', Q.like(`%${needle}%`)), Q.sortBy('created_at_ms', Q.desc), Q.take(lim))
    .fetch();

  return rows.map((m: any) => ({
    roomType: m.roomType,
    roomId: m.roomId,
    messageId: m.messageId,
    createdAtMs: m.createdAtMs,
    senderName: m.senderName ?? null,
    text: m.text ?? null,
    kind: m.kind ?? null,
  }));
}

