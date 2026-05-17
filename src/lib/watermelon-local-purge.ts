import { Q } from '@nozbe/watermelondb';
import { Platform } from 'react-native';

import { resetChatMessageFtsBootstrapState } from '@/src/watermelon/fts';
import { database } from '@/src/watermelon';

const PURGE_BATCH = 200;

const CHAT_MESSAGE_FTS_TRIGGERS = ['chat_messages_ai', 'chat_messages_au', 'chat_messages_ad'] as const;

/** 로그아웃·탈퇴 시 비울 Watermelon 테이블(사용자 스코프·공유 기기 격리). */
export const USER_SCOPED_WATERMELON_TABLES = [
  'chat_messages',
  'chat_rooms',
  'chat_search_index_chunks',
  'recent_searches',
  'cached_meeting_details',
  'cached_user_profiles',
  'cached_meeting_categories',
] as const;

type SqliteUnsafeExecute = (query: { sqlString: string }) => Promise<void>;

function getSqliteAdapter(): { unsafeExecute: SqliteUnsafeExecute } | null {
  const db = database;
  if (!db) return null;
  const adapter = (db as { adapter?: { unsafeExecute?: SqliteUnsafeExecute } }).adapter;
  if (!adapter || typeof adapter.unsafeExecute !== 'function') return null;
  return adapter;
}

async function unsafeSqlBatch(statements: string[]): Promise<void> {
  const adapter = getSqliteAdapter();
  if (!adapter || statements.length === 0) return;
  await adapter.unsafeExecute({ sqlString: statements.join(' ') });
}

async function destroyAllInCollection(table: string): Promise<void> {
  const db = database;
  if (!db) return;
  const collection = db.get(table);
  for (;;) {
    const batch = await collection.query(Q.take(PURGE_BATCH)).fetch();
    if (batch.length === 0) break;
    await db.write(async () => {
      for (const row of batch) {
        await row.destroyPermanently();
      }
    });
  }
}

/** 일부 Android SQLite 빌드는 fts5 모듈이 없음 — 실패해도 본 purge는 계속 */
async function tryDropChatMessageFtsArtifacts(): Promise<void> {
  try {
    await unsafeSqlBatch([
      ...CHAT_MESSAGE_FTS_TRIGGERS.map((trigger) => `DROP TRIGGER IF EXISTS ${trigger};`),
      'DROP TABLE IF EXISTS chat_messages_fts;',
    ]);
  } catch {
    /* fts5 미지원·FTS 미생성 */
  }
}

/**
 * FTS DELETE 트리거가 행마다 실행되면 수만 건 삭제 시 JS 스레드가 멈춥니다.
 * 로그아웃 purge는 트리거를 잠시 제거한 뒤 `DELETE FROM`으로 한 번에 비웁니다.
 */
async function fastSqlPurgeUserScopedTables(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const adapter = getSqliteAdapter();
  if (!adapter) return false;

  await tryDropChatMessageFtsArtifacts();
  await unsafeSqlBatch(
    USER_SCOPED_WATERMELON_TABLES.map((table) => `DELETE FROM ${table};`),
  );

  resetChatMessageFtsBootstrapState();
  return true;
}

/** 로그아웃·탈퇴 — 다른 계정 로그인 시 이전 사용자 로컬 DB가 섞이지 않도록 전부 비웁니다. */
export async function purgeLocalUserScopedWatermelonOnSignOut(): Promise<void> {
  if (__DEV__) console.log('[watermelon-purge] start');
  try {
    const usedFast = await fastSqlPurgeUserScopedTables();
    if (usedFast) {
      if (__DEV__) console.log('[watermelon-purge] fast SQL purge done');
      return;
    }
  } catch (e) {
    if (__DEV__) {
      console.warn(
        '[watermelon-purge] fast path failed, falling back to batch destroy:',
        e instanceof Error ? e.message : e,
      );
    }
  }

  for (const table of USER_SCOPED_WATERMELON_TABLES) {
    await destroyAllInCollection(table);
  }
  if (__DEV__) console.log('[watermelon-purge] batch destroy done');
}

/** @deprecated `purgeLocalUserScopedWatermelonOnSignOut` 사용 */
export const purgeLocalChatWatermelonOnSignOut = purgeLocalUserScopedWatermelonOnSignOut;
