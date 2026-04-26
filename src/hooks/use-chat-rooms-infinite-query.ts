import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import {
  fetchChatRoomsListPageHybrid,
  subscribeChatRoomsListInvalidate,
} from '@/src/lib/supabase-chat-rooms-list';

/** TanStack 캐시 키 — 사용자별로 분리(재로그인 시 섞이지 않게) */
export function chatRoomsQueryKey(userId: string) {
  return ['chat_rooms', userId.trim()] as const;
}

type Page = { rooms: SocialChatRoomSummary[]; hasMore: boolean };

export function useChatRoomsInfiniteQuery(userId: string | null | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const uid = userId?.trim() ?? '';
  const queryKey = useMemo(() => chatRoomsQueryKey(uid), [uid]);
  const didLogCacheRef = useRef(false);

  useEffect(() => {
    didLogCacheRef.current = false;
  }, [uid]);

  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(uid) && enabled,
    initialPageParam: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }): Promise<Page> => {
      // eslint-disable-next-line no-console
      console.log('📡 채팅방 목록: 서버 동기화 중 (Page: ' + pageParam + ')');
      return fetchChatRoomsListPageHybrid(uid, pageParam as number);
    },
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
  });

  const rooms = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const seen = new Set<string>();
    const out: SocialChatRoomSummary[] = [];
    for (const p of pages) {
      for (const r of p.rooms) {
        if (seen.has(r.roomId)) continue;
        seen.add(r.roomId);
        out.push(r);
      }
    }
    return out;
  }, [query.data]);

  useEffect(() => {
    if (!enabled || !uid) return;
    if (rooms.length === 0 && !query.isSuccess) return;
    if (didLogCacheRef.current) return;
    didLogCacheRef.current = true;
    // eslint-disable-next-line no-console
    console.log('📦 채팅방 목록: 로컬 캐시 로드 완료');
  }, [enabled, uid, rooms.length, query.isSuccess]);

  useEffect(() => {
    if (!enabled || !uid) return;
    return subscribeChatRoomsListInvalidate(
      () => {
        void queryClient.invalidateQueries({ queryKey: ['chat_rooms'] });
      },
      () => {
        /* Realtime 오류는 탭에서 별도 배너 없이 무시 가능 */
      },
    );
  }, [enabled, uid, queryClient]);

  const listError =
    query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;

  const fetchNextPageGuarded = useCallback(async () => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    await query.fetchNextPage();
  }, [query]);

  return {
    rooms,
    listError,
    refetch: query.refetch,
    fetchNextPage: fetchNextPageGuarded,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    isInitialLoading: query.isPending && rooms.length === 0,
  };
}
