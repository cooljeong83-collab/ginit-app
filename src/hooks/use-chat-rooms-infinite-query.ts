import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import { useLocalChatRoomSummaries } from '@/src/hooks/use-local-chat-room-summaries';
import { syncServerParticipantUnreadToLocalWatermelon } from '@/src/lib/chat-local-unread-sync';
import {
  upsertLocalChatRoomSummary,
  type LocalChatRoomSummary,
} from '@/src/lib/offline-chat/offline-chat-rooms';
import { incrementalSyncRoomMessagesToLocal } from '@/src/lib/offline-chat/offline-chat-sync';
import {
  fetchChatRoomsListPageHybrid,
  fetchChatRoomsChangeSummariesFromSupabase,
} from '@/src/lib/supabase-chat-rooms-list';
import { subscribeChatListRefresh } from '@/src/lib/user-chat-list-refresh-bus';

export { chatRoomsListQueryKey, chatRoomsListQueryKey as chatRoomsQueryKey } from '@/src/lib/chat-query-keys';

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
  const queryClient = useQueryClient();
  const uid = userId?.trim() ?? '';
  const didLogCacheRef = useRef(false);
  const didAttemptEmptyRecoveryRef = useRef(false);
  const [syncing, setSyncing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  /** FlashList가 동기화 직후에도 셀을 다시 그리도록 하는 단조 증가 키 */
  const [listRenderRev, setListRenderRev] = useState(0);
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

  const syncChangedRooms = useCallback(async (opts?: { pullTail?: boolean }) => {
    if (!enabled || !uid) return;
    setSyncing(true);
    setListError(null);
    let syncedSocialRoomIds: string[] = [];
    try {
      const summariesRes = await fetchChatRoomsChangeSummariesFromSupabase(uid);
      if (summariesRes.ok && summariesRes.summaries.length > 0) {
        await upsertSocialRoomsPageToLocal(uid, summariesRes.summaries);
        syncedSocialRoomIds = summariesRes.summaries.map((s) => s.roomId.trim()).filter(Boolean);
      } else {
        const page = await fetchChatRoomsListPageHybrid(uid, 0);
        if (page.rooms.length > 0) {
          await upsertSocialRoomsPageToLocal(uid, page.rooms);
          syncedSocialRoomIds = page.rooms.map((r) => r.roomId.trim()).filter(Boolean);
        }
        if (!summariesRes.ok) {
          setListError(summariesRes.message);
        }
      }
      /** RPC 목록에는 `unread_count`가 없음 — `chat_room_participants` 일괄 조회로 Watermelon·TanStack 배지 정합 */
      await syncServerParticipantUnreadToLocalWatermelon(uid, { queryClient });
      /** 당겨서 새로고침: 목록 메타만으로는 `last_message_*`가 안 바뀌므로 소셜 방별 최근 메시지 tail만 제한 동기화 */
      if (opts?.pullTail && uid) {
        const ids = [...new Set(syncedSocialRoomIds)].filter((id) => id.startsWith('social_')).slice(0, 12);
        for (let i = 0; i < ids.length; i += 3) {
          const chunk = ids.slice(i, i + 3);
          await Promise.all(
            chunk.map((roomId) =>
              incrementalSyncRoomMessagesToLocal({
                key: { roomType: 'social_dm', roomId },
                appUserId: uid,
                maxDocs: 40,
                maxPagesPerRun: 1,
                pageSize: 40,
                timeBudgetMs: 900,
              }).catch(() => undefined),
            ),
          );
        }
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListRenderRev((x) => x + 1);
      setSyncing(false);
    }
  }, [enabled, queryClient, uid]);

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
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeChatListRefresh(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void syncChangedRooms();
      }, 320);
    });
    return () => {
      unsub();
      if (debounce) clearTimeout(debounce);
    };
  }, [enabled, uid, syncChangedRooms]);

  const fetchNextPageGuarded = useCallback(async () => {}, []);

  return {
    rooms,
    listError,
    listRenderRev,
    refetch: syncChangedRooms,
    syncChangedRooms,
    fetchNextPage: fetchNextPageGuarded,
    hasNextPage: false,
    isFetchingNextPage: false,
    isInitialLoading: false,
    isListSyncing: syncing,
  };
}
