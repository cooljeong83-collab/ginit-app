import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { meetingListSource } from '@/src/lib/hybrid-data-source';
import type { Meeting } from '@/src/lib/meetings';
import { fetchMeetingsOnce } from '@/src/lib/meetings';
import {
  fetchPublicMeetingsPageFromSupabase,
  subscribePublicMeetingsListInvalidate,
} from '@/src/lib/supabase-meetings-list';

type Page = { meetings: Meeting[]; hasMore: boolean };

export type UseMeetingsFeedInfiniteQueryOptions = {
  /** false면 fetch·Realtime 구독 안 함(채팅 탭 친구 전용일 때 등). 기본 true */
  enabled?: boolean;
  /**
   * 캐시 신선도(ms). 미지정 시 `0` — `PersistQueryClient` 복원 직후에도 전역 staleTime(10분) 때문에
   * 마운트 시 refetch가 생략되어 빈 목록에 고이는 현상을 막습니다.
   */
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
};

export function meetingsFeedInfiniteQueryKey() {
  return ['meetings', 'feed', meetingListSource()] as const;
}

async function fetchMeetingsFeedPage(pageParam: number): Promise<Page> {
  if (meetingListSource() === 'firestore') {
    if (pageParam !== 0) return { meetings: [], hasMore: false };
    const r = await fetchMeetingsOnce();
    if (!r.ok) throw new Error(r.message);
    return { meetings: r.meetings, hasMore: false };
  }

  // eslint-disable-next-line no-console
  console.log('📡 모임 목록: 서버 데이터 10개 가져오기 (Page: ' + pageParam + ')');
  const res = await fetchPublicMeetingsPageFromSupabase(pageParam);
  if (!res.ok) throw new Error(res.message);
  return { meetings: res.meetings, hasMore: res.hasMore };
}

export function useMeetingsFeedInfiniteQuery(options?: UseMeetingsFeedInfiniteQueryOptions) {
  const enabled = options?.enabled ?? true;
  const staleTimeOpt = options?.staleTime;
  const refetchOnWindowFocusOpt = options?.refetchOnWindowFocus;
  const queryClient = useQueryClient();

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('📦 모임 목록: 로컬 캐시 로드 시도');
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (meetingListSource() !== 'supabase') return;
    const flushInvalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['meetings', 'feed'] });
    };
    const unsub = subscribePublicMeetingsListInvalidate(
      (payload) => {
        /**
         * `meetings` UPDATE는 채팅 읽음(`writeMeetingChatReadReceipt`)·ledger 문서 병합 등
         * 피드 카드와 무관한 변경이 대부분이라 무효화하면 채팅방 재진입만으로도
         * 홈 피드가 `fetchPublicMeetingsPageFromSupabase`를 반복 호출합니다.
         * 목록에 새 행이 생기거나 사라질 때만 무효화하고, 그 외 갱신은 당겨서 새로고침에 맡깁니다.
         */
        if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
          flushInvalidate();
        }
      },
      () => {
        /* Realtime 오류는 피드에서 별도 배너 없이 무시 가능 */
      },
    );
    return () => {
      unsub();
    };
  }, [queryClient, enabled]);

  const feedSource = meetingListSource();
  const queryKey = useMemo(() => meetingsFeedInfiniteQueryKey(), [feedSource]);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 0,
    /** 당겨서 새로고침(refetch) 직후 `data`가 잠깐 비는 동안 목록이 통째로 사라지는 것을 막습니다. */
    placeholderData: (previousData) => previousData,
    staleTime: staleTimeOpt ?? 0,
    /** 복원된 캐시가 비어 있어도 `staleTime`만으로는 갱신이 막히지 않게 항상 마운트 시 네트워크 동기화 */
    refetchOnMount: 'always',
    ...(refetchOnWindowFocusOpt !== undefined ? { refetchOnWindowFocus: refetchOnWindowFocusOpt } : {}),
    queryFn: ({ pageParam }) => fetchMeetingsFeedPage(pageParam as number),
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
  });

  const meetings = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const p of pages) {
      for (const m of p.meetings) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }, [query.data]);

  const listError =
    query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;

  const showFooterSpinner =
    query.isFetchingNextPage ||
    (query.isPending && meetings.length === 0) ||
    (query.isFetching && meetings.length > 0);

  return {
    meetings,
    listError,
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    showFooterSpinner,
    /** 초기 데이터 없음 + 아직 첫 응답 전 — 빈 상태·에러 박스 게이트용 */
    isInitialListLoading: query.isPending && meetings.length === 0,
  };
}
