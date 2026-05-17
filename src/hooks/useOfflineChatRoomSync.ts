import { useEffect, useMemo, useRef, useState } from 'react';

import type { OfflineChatRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey, roomKeyToString } from '@/src/lib/offline-chat/offline-chat-types';
import { backfillOlderRoomMessagesToLocal, incrementalSyncRoomMessagesToLocal } from '@/src/lib/offline-chat/offline-chat-sync';
import { pruneLocalChatRoomMessages } from '@/src/lib/offline-chat/offline-chat-pruning';

const ROOM_SYNC_TIMEOUT_MS = 4000;

function roomKeyFromSyncKeyStr(syncKeyStr: string): OfflineChatRoomKey | null {
  const sep = syncKeyStr.indexOf(':');
  if (sep < 0) return null;
  const roomTypeRaw = syncKeyStr.slice(0, sep);
  const roomId = syncKeyStr.slice(sep + 1).trim();
  if (!roomId) return null;
  return normalizeRoomKey({
    roomType: roomTypeRaw === 'social_dm' ? 'social_dm' : 'meeting',
    roomId,
  });
}

function runRoomSync(key: OfflineChatRoomKey, appUserId?: string | null): Promise<void> {
  const work = incrementalSyncRoomMessagesToLocal({
    key,
    appUserId: appUserId ?? undefined,
    initialSinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000,
    pageSize: 200,
    maxDocs: 1200,
    latestBlockSize: 80,
    maxPagesPerRun: 2,
    timeBudgetMs: 1800,
  })
    .then(() =>
      backfillOlderRoomMessagesToLocal({
        key,
        appUserId: appUserId ?? undefined,
        pageSize: 100,
        maxPages: 1,
        timeBudgetMs: 900,
      }),
    )
    .then(() => pruneLocalChatRoomMessages({ key }));

  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, ROOM_SYNC_TIMEOUT_MS);
  });

  return Promise.race([work, timeout]).then(() => undefined);
}

/**
 * 채팅방 진입 시 로컬 DB를 최신으로 맞추는 "가벼운" 증분 동기화 훅.
 */
export function useOfflineChatRoomSync(
  key: OfflineChatRoomKey | null | undefined,
  enabled: boolean,
  appUserId?: string | null,
): { roomSyncSettled: boolean } {
  const inflightRef = useRef<Promise<void> | null>(null);
  const settledKeyRef = useRef('');
  const activeSyncKeyRef = useRef('');

  const syncKeyStr = useMemo(() => {
    if (!key?.roomId?.trim()) return '';
    return roomKeyToString(normalizeRoomKey(key));
  }, [key?.roomId, key?.roomType]);

  const [roomSyncSettled, setRoomSyncSettled] = useState(() => !enabled || !syncKeyStr);

  useEffect(() => {
    if (!enabled || !syncKeyStr) {
      setRoomSyncSettled(true);
      inflightRef.current = null;
      return;
    }

    if (activeSyncKeyRef.current !== syncKeyStr) {
      activeSyncKeyRef.current = syncKeyStr;
      settledKeyRef.current = '';
      inflightRef.current = null;
    }

    if (settledKeyRef.current === syncKeyStr) {
      setRoomSyncSettled(true);
      return;
    }

    if (inflightRef.current) {
      return;
    }

    const normalizedKey = roomKeyFromSyncKeyStr(syncKeyStr);
    if (!normalizedKey) {
      setRoomSyncSettled(true);
      return;
    }

    setRoomSyncSettled(false);

    inflightRef.current = runRoomSync(normalizedKey, appUserId)
      .catch((e) => {
        if (__DEV__) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log('[useOfflineChatRoomSync] sync failed', msg);
        }
      })
      .finally(() => {
        inflightRef.current = null;
        settledKeyRef.current = syncKeyStr;
        setRoomSyncSettled(true);
      });
  }, [appUserId, enabled, syncKeyStr]);

  return { roomSyncSettled };
}
