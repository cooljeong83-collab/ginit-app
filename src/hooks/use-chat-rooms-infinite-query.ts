import { useCallback, useEffect, useRef, useState } from 'react';

import type { SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import { useLocalChatRoomSummaries } from '@/src/hooks/use-local-chat-room-summaries';
import {
  upsertLocalChatRoomSummary,
  type LocalChatRoomSummary,
} from '@/src/lib/offline-chat/offline-chat-rooms';
import {
  fetchChatRoomsListPageHybrid,
  fetchChatRoomsChangeSummariesFromSupabase,
  subscribeChatRoomsListInvalidate,
} from '@/src/lib/supabase-chat-rooms-list';

/** TanStack 캐시 키 — 사용자별로 분리(재로그인 시 섞이지 않게) */
export function chatRoomsQueryKey(userId: string) {
  return ['chat_rooms', userId.trim()] as const;
}

type ChatRoomListRow = SocialChatRoomSummary | LocalChatRoomSummary;

const attemptedEmptyRecoveryUserIds = new Set<string>();

async function upsertSocialRoomsPageToLocal(
  ownerUserId: string,
  rooms: readonly ChatRoomListRow[],
  remoteUpdatedAtMs: number = Date.now(),
): Promise<void> {
  const owner = ownerUserId.trim();
  if (!owner || rooms.length === 0) return;
  await Promise.all(
    rooms.map((r) =>
      upsertLocalChatRoomSummary({
        roomType: 'social_dm',
        roomId: r.roomId,
        ownerUserId: owner,
        peerUserId: r.peerAppUserId,
        isGroup: false,
        unreadLastAtMs: (r as LocalChatRoomSummary).unreadLastAtMs || (r as { changedAtMs?: number }).changedAtMs || remoteUpdatedAtMs,
        remoteUpdatedAtMs: (r as LocalChatRoomSummary).remoteUpdatedAtMs || (r as { changedAtMs?: number }).changedAtMs || remoteUpdatedAtMs,
      }),
    ),
  );
}

export function useChatRoomsInfiniteQuery(userId: string | null | undefined, enabled: boolean) {
  const uid = userId?.trim() ?? '';
  const didLogCacheRef = useRef(false);
  const didAttemptEmptyRecoveryRef = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const localRooms = useLocalChatRoomSummaries({
    roomType: 'social_dm',
    ownerUserId: uid,
    enabled: Boolean(uid) && enabled,
  });

  useEffect(() => {
    didLogCacheRef.current = false;
    didAttemptEmptyRecoveryRef.current = uid ? attemptedEmptyRecoveryUserIds.has(uid) : false;
    setListError(null);
  }, [uid]);

  const rooms = localRooms;

  const syncChangedRooms = useCallback(async () => {
    if (!enabled || !uid) return;
    setSyncing(true);
    setListError(null);
    try {
      const summariesRes = await fetchChatRoomsChangeSummariesFromSupabase(uid);
      if (summariesRes.ok && summariesRes.summaries.length > 0) {
        await upsertSocialRoomsPageToLocal(uid, summariesRes.summaries);
        return;
      }
      const page = await fetchChatRoomsListPageHybrid(uid, 0);
      if (page.rooms.length > 0) {
        await upsertSocialRoomsPageToLocal(uid, page.rooms);
        return;
      }
      if (!summariesRes.ok) {
        setListError(summariesRes.message);
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [enabled, uid]);

  useEffect(() => {
    if (!enabled || !uid) return;
    if (rooms.length > 0) return;
    if (syncing) return;
    if (didAttemptEmptyRecoveryRef.current) return;

    const timer = setTimeout(() => {
      if (didAttemptEmptyRecoveryRef.current) return;
      didAttemptEmptyRecoveryRef.current = true;
      attemptedEmptyRecoveryUserIds.add(uid);
      void syncChangedRooms();
    }, 250);

    return () => clearTimeout(timer);
  }, [enabled, rooms.length, syncing, syncChangedRooms, uid]);

  useEffect(() => {
    if (!enabled || !uid) return;
    if (rooms.length === 0) return;
    if (didLogCacheRef.current) return;
    didLogCacheRef.current = true;
    // eslint-disable-next-line no-console
    console.log('📦 채팅방 목록: 로컬 캐시 로드 완료');
  }, [enabled, uid, rooms.length]);

  useEffect(() => {
    if (!enabled || !uid) return undefined;
    return subscribeChatRoomsListInvalidate(uid, () => {
      void syncChangedRooms();
    });
  }, [enabled, uid, syncChangedRooms]);

  const fetchNextPageGuarded = useCallback(async () => {}, []);

  return {
    rooms,
    listError,
    refetch: syncChangedRooms,
    syncChangedRooms,
    fetchNextPage: fetchNextPageGuarded,
    hasNextPage: false,
    isFetchingNextPage: syncing,
    isInitialLoading: false,
  };
}
