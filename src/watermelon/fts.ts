import { Platform } from 'react-native';

import { database } from '@/src/watermelon/database';

/**
 * SQLite FTS5 부트스트랩.
 *
 * 비용/성능 목표:
 * - Firestore Read를 줄이려면 "검색"은 로컬에서 끝나야 합니다.
 * - LIKE 스캔 대신 FTS5(MATCH)로 O(logN)에 가깝게 검색합니다.
 *
 * 구현 메모:
 * - WatermelonDB의 표준 query API는 FTS MATCH를 직접 지원하지 않습니다.
 * - 따라서 sqlite adapter의 unsafeExecute/unsafeSqlQuery를 사용합니다(네이티브에서만).
 * - 안전장치: web에서는 no-op.
 */

let didInit = false;

export async function ensureChatMessageFtsReady(): Promise<void> {
  if (didInit) return;
  if (Platform.OS === 'web') return;
  const db = database;
  if (!db) return;
  didInit = true;

  const adapter: any = (db as any).adapter;
  if (!adapter || typeof adapter.unsafeExecute !== 'function') {
    // adapter가 바뀌었거나 unsafeExecute가 없는 환경이면 FTS를 생략(폴백: LIKE)
    return;
  }

  // contentless FTS table: message_key를 저장하고, search_text만 인덱싱
  // NOTE: UNINDEXED는 FTS5에서 토큰화/인덱싱을 막습니다.
  await adapter.unsafeExecute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts
    USING fts5(
      message_key UNINDEXED,
      room_id UNINDEXED,
      room_type UNINDEXED,
      search_text,
      tokenize = 'unicode61'
    );
  `);

  // 트리거: chat_messages의 search_text 변경을 FTS에 반영
  // - WatermelonDB는 table에 id(문자열 PK)를 포함합니다.
  // - message_key에는 "roomType:roomId:messageId"를 저장해 역참조합니다.
  await adapter.unsafeExecute(`
    CREATE TRIGGER IF NOT EXISTS chat_messages_ai
    AFTER INSERT ON chat_messages
    BEGIN
      INSERT INTO chat_messages_fts(message_key, room_id, room_type, search_text)
      VALUES (
        new.room_type || ':' || new.room_id || ':' || new.message_id,
        new.room_id,
        new.room_type,
        COALESCE(new.search_text, '')
      );
    END;
  `);

  await adapter.unsafeExecute(`
    CREATE TRIGGER IF NOT EXISTS chat_messages_au
    AFTER UPDATE OF search_text ON chat_messages
    BEGIN
      DELETE FROM chat_messages_fts WHERE message_key = old.room_type || ':' || old.room_id || ':' || old.message_id;
      INSERT INTO chat_messages_fts(message_key, room_id, room_type, search_text)
      VALUES (
        new.room_type || ':' || new.room_id || ':' || new.message_id,
        new.room_id,
        new.room_type,
        COALESCE(new.search_text, '')
      );
    END;
  `);

  await adapter.unsafeExecute(`
    CREATE TRIGGER IF NOT EXISTS chat_messages_ad
    AFTER DELETE ON chat_messages
    BEGIN
      DELETE FROM chat_messages_fts WHERE message_key = old.room_type || ':' || old.room_id || ':' || old.message_id;
    END;
  `);
}

export async function unsafeFtsSearchMessageKeys(args: {
  roomType?: string;
  roomId?: string;
  needle: string;
  limit?: number;
}): Promise<string[]> {
  if (Platform.OS === 'web') return [];
  const db = database;
  if (!db) return [];
  const adapter: any = (db as any).adapter;
  if (!adapter || typeof adapter.unsafeSqlQuery !== 'function') return [];

  const needle = String(args.needle ?? '').trim();
  if (!needle) return [];
  const lim = Math.min(Math.max(5, args.limit ?? 60), 200);

  // FTS MATCH 문법을 그대로 사용(phrase/AND 등 고급 문법 가능)
  const whereParts: string[] = [];
  const params: any[] = [];
  if (args.roomType?.trim()) {
    whereParts.push('room_type = ?');
    params.push(args.roomType.trim());
  }
  if (args.roomId?.trim()) {
    whereParts.push('room_id = ?');
    params.push(args.roomId.trim());
  }
  whereParts.push('chat_messages_fts MATCH ?');
  params.push(needle);

  const sql = `
    SELECT message_key
    FROM chat_messages_fts
    WHERE ${whereParts.join(' AND ')}
    LIMIT ${lim};
  `;

  const res = await adapter.unsafeSqlQuery(sql, params);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? res?.[0] ?? [];
  const out: string[] = [];
  for (const r of rows) {
    const k = typeof r?.message_key === 'string' ? r.message_key : typeof r?.[0] === 'string' ? r[0] : '';
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export type FtsSnippetRow = { messageKey: string; snippet: string; score: number };

export async function unsafeFtsSearchSnippets(args: {
  roomType?: string;
  roomId?: string;
  needle: string;
  limit?: number;
}): Promise<FtsSnippetRow[]> {
  if (Platform.OS === 'web') return [];
  const db = database;
  if (!db) return [];
  const adapter: any = (db as any).adapter;
  if (!adapter || typeof adapter.unsafeSqlQuery !== 'function') return [];

  const needle = String(args.needle ?? '').trim();
  if (!needle) return [];
  const lim = Math.min(Math.max(5, args.limit ?? 60), 200);

  const whereParts: string[] = [];
  const params: any[] = [];
  if (args.roomType?.trim()) {
    whereParts.push('room_type = ?');
    params.push(args.roomType.trim());
  }
  if (args.roomId?.trim()) {
    whereParts.push('room_id = ?');
    params.push(args.roomId.trim());
  }
  whereParts.push('chat_messages_fts MATCH ?');
  params.push(needle);

  // column index 3 = search_text
  // snippet()은 매치 주변으로 텍스트를 잘라주고, 마커로 하이라이트를 표시할 수 있습니다.
  const sql = `
    SELECT
      message_key,
      snippet(chat_messages_fts, 3, '[[', ']]', '…', 12) AS snip,
      bm25(chat_messages_fts) AS score
    FROM chat_messages_fts
    WHERE ${whereParts.join(' AND ')}
    ORDER BY score ASC
    LIMIT ${lim};
  `;

  const res = await adapter.unsafeSqlQuery(sql, params);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? res?.[0] ?? [];
  const out: FtsSnippetRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const messageKey = typeof r?.message_key === 'string' ? r.message_key : '';
    if (!messageKey || seen.has(messageKey)) continue;
    seen.add(messageKey);
    const snippet = typeof r?.snip === 'string' ? r.snip : '';
    const score = typeof r?.score === 'number' ? r.score : Number(r?.score ?? 0) || 0;
    out.push({ messageKey, snippet, score });
  }
  return out;
}

