import { useEffect, useRef } from 'react';

import type { OfflineChatRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey, roomKeyToString } from '@/src/lib/offline-chat/offline-chat-types';
import { backfillOlderRoomMessagesToLocal, incrementalSyncRoomMessagesToLocal } from '@/src/lib/offline-chat/offline-chat-sync';
import { pruneLocalChatRoomMessages } from '@/src/lib/offline-chat/offline-chat-pruning';

/**
 * 채팅방 진입 시 로컬 DB를 최신으로 맞추는 "가벼운" 증분 동기화 훅.
 * - Supabase RPC·Postgres 스캔을 통제하기 위해 page/maxDocs/timeBudget 상한을 강제합니다.
 * - `EXPO_PUBLIC_CHAT_DELTA_TRANSPORT=supabase` 일 때는 `appUserId`(세션 PK)를 넘겨야 Supabase RPC 델타가 동작합니다.
 */
export function useOfflineChatRoomSync(
  key: OfflineChatRoomKey | null | undefined,
  enabled: boolean,
  appUserId?: string | null,
) {
  const inflightRef = useRef<Promise<unknown> | null>(null);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    if (!enabled || !key) return;
    const k = normalizeRoomKey(key);
    const kstr = roomKeyToString(k);
    if (!k.roomId) return;
    if (lastKeyRef.current !== kstr) {
      lastKeyRef.current = kstr;
      inflightRef.current = null;
    }
    if (inflightRef.current) return;
    inflightRef.current = incrementalSyncRoomMessagesToLocal({
      key: k,
      appUserId: appUserId ?? undefined,
      // 기본: 최근 7일만 초기 pull (Read 폭주 방지)
      initialSinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
      pageSize: 200,
      maxDocs: 1200,
      latestBlockSize: 80,
      maxPagesPerRun: 2,
      timeBudgetMs: 1800,
    })
      .then(() => backfillOlderRoomMessagesToLocal({ key: k, appUserId: appUserId ?? undefined, pageSize: 100, maxPages: 1, timeBudgetMs: 900 }))
      .then(() => pruneLocalChatRoomMessages({ key: k }))
      .catch((e) => {
        if (__DEV__) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log('[useOfflineChatRoomSync] sync failed (will retry on remount)', msg);
        }
      })
      .finally(() => {
        inflightRef.current = null;
      });
  }, [enabled, key, appUserId]);
}

