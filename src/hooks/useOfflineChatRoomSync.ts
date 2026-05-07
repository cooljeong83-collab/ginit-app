import { useEffect, useRef } from 'react';

import type { OfflineChatRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey, roomKeyToString } from '@/src/lib/offline-chat/offline-chat-types';
import { incrementalSyncRoomMessagesToLocal } from '@/src/lib/offline-chat/offline-chat-sync';

/**
 * 채팅방 진입 시 로컬 DB를 최신으로 맞추는 "가벼운" 증분 동기화 훅.
 * - Firestore Read 비용을 통제하기 위해 page/maxDocs 상한을 강제합니다.
 */
export function useOfflineChatRoomSync(key: OfflineChatRoomKey | null | undefined, enabled: boolean) {
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
      // 기본: 최근 7일만 초기 pull (Read 폭주 방지)
      initialSinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
      pageSize: 200,
      maxDocs: 1200,
    }).finally(() => {
      inflightRef.current = null;
    });
  }, [enabled, key]);
}

