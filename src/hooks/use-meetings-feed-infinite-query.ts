import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Meeting } from '@/src/lib/meetings';
import { recordMeetingsListPageFetchedFromNetwork } from '@/src/lib/meetings-feed-deferred-sync';
import { applyPublicMeetingsFeedSummarySync } from '@/src/lib/meetings-feed-incremental-sync-core';
import { slimMeetingForFeedList } from '@/src/lib/meetings-feed-list-slim';
import type { MeetingsFeedPageSlice } from '@/src/lib/meetings-feed-page-utils';
import { meetingsFeedInfiniteQueryKey } from '@/src/lib/meetings-query-keys';
import {
  fetchPublicMeetingsPageFromSupabase,
  type PublicMeetingsFeedCursor,
} from '@/src/lib/supabase-meetings-list';

type Page = MeetingsFeedPageSlice;
type FeedInfiniteData = InfiniteData<Page, PublicMeetingsFeedCursor | undefined>;

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

export { meetingsFeedInfiniteQueryKey };

function flattenPages(data: FeedInfiniteData | undefined): Meeting[] {
  const pages = data?.pages ?? [];
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const p of pages) {
    for (const m of p.meetings) {
      const id = typeof m.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(m);
    }
  }
  return out;
}

async function fetchMeetingsFeedPage(pageParam: PublicMeetingsFeedCursor | undefined): Promise<Page> {
  const res = await fetchPublicMeetingsPageFromSupabase(pageParam ?? null);
  if (!res.ok) throw new Error(res.message);
  recordMeetingsListPageFetchedFromNetwork();
  const page: Page = { meetings: res.meetings, hasMore: res.hasMore };
  if (res.tailCursor) page.tailCursor = res.tailCursor;
  return page;
}

export function useMeetingsFeedInfiniteQuery(options?: UseMeetingsFeedInfiniteQueryOptions) {
  const enabled = options?.enabled ?? true;
  const staleTimeOpt = options?.staleTime;
  const refetchOnWindowFocusOpt = options?.refetchOnWindowFocus;
  const queryClient = useQueryClient();

  const queryKey = useMemo(() => meetingsFeedInfiniteQueryKey(), []);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: undefined as PublicMeetingsFeedCursor | undefined,
    /** 당겨서 새로고침(refetch) 직후 `data`가 잠깐 비는 동안 목록이 통째로 사라지는 것을 막습니다. */
    placeholderData: (previousData) => previousData,
    /** 미지정 시 0 — Persist 복원 직후·탈퇴 재가입 등 빈 캐시가 staleTime(전역 10분)에 묶여 첫 fetch가 생략되는 것을 막음 */
    staleTime: staleTimeOpt ?? 0,
    /** 화면 진입 시에는 persisted cache를 먼저 그리고, 별도 summary sync로 필요한 ID만 갱신합니다. */
    refetchOnMount: false,
    refetchOnWindowFocus: refetchOnWindowFocusOpt ?? false,
    queryFn: ({ pageParam }) => fetchMeetingsFeedPage(pageParam),
    getNextPageParam: (lastPage: Page) => {
      if (!lastPage.hasMore) return undefined;
      return lastPage.tailCursor;
    },
    select: (data: FeedInfiniteData) => ({
      pageParams: data.pageParams,
      pages: data.pages.map((p) => ({
        ...p,
        meetings: p.meetings.map(slimMeetingForFeedList),
      })),
    }),
  });

  const syncChangedMeetings = useCallback(async () => {
    if (!enabled) return;
    await applyPublicMeetingsFeedSummarySync(queryClient);
  }, [enabled, queryClient]);

  const meetings = useMemo(() => flattenPages(query.data as FeedInfiniteData | undefined), [query.data]);

  const listError =
    query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;

  /** 하단 스피너는 무한 스크롤 다음 페이지만. 백그라운드 refetch(`isFetching`)는 persist·재로그인 직후에도 목록을 유지합니다. */
  const showFooterSpinner =
    query.isFetchingNextPage || (query.isPending && meetings.length === 0);

  return {
    meetings,
    listError,
    refetch: query.refetch,
    syncChangedMeetings,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    showFooterSpinner,
    /** 초기 데이터 없음 + 아직 첫 응답 전 — 빈 상태·에러 박스 게이트용 */
    isInitialListLoading: query.isPending && meetings.length === 0,
  };
}
