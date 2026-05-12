import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { meetingListSource } from '@/src/lib/hybrid-data-source';
import type { Meeting } from '@/src/lib/meetings';
import { fetchMeetingsOnce } from '@/src/lib/meetings';
import {
  diffMeetingSummaries,
  fetchMeetingsForSyncByIds,
  fetchPublicMeetingChangeSummaries,
  fetchPublicMeetingsPageFromSupabase,
  mergeMeetingsBySummaries,
  PUBLIC_MEETINGS_PAGE_SIZE,
  subscribePublicMeetingsListInvalidate,
} from '@/src/lib/supabase-meetings-list';

type Page = { meetings: Meeting[]; hasMore: boolean };
type FeedInfiniteData = InfiniteData<Page, number>;

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

function flattenPages(data: FeedInfiniteData | undefined): Meeting[] {
  const pages = data?.pages ?? [];
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
}

function buildPagesFromMeetings(meetings: readonly Meeting[], pageCount: number, remoteSummaryCount: number): Page[] {
  const count = Math.max(1, pageCount);
  return Array.from({ length: count }, (_, idx) => {
    const from = idx * PUBLIC_MEETINGS_PAGE_SIZE;
    const slice = meetings.slice(from, from + PUBLIC_MEETINGS_PAGE_SIZE);
    return {
      meetings: slice,
      hasMore: remoteSummaryCount > from + slice.length,
    };
  }).filter((page, idx) => idx === 0 || page.meetings.length > 0);
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

  const feedSource = meetingListSource();
  const queryKey = useMemo(() => meetingsFeedInfiniteQueryKey(), [feedSource]);

  const query = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 0,
    /** 당겨서 새로고침(refetch) 직후 `data`가 잠깐 비는 동안 목록이 통째로 사라지는 것을 막습니다. */
    placeholderData: (previousData) => previousData,
    staleTime: staleTimeOpt ?? 10 * 60 * 1000,
    /** 화면 진입 시에는 persisted cache를 먼저 그리고, 별도 summary sync로 필요한 ID만 갱신합니다. */
    refetchOnMount: false,
    ...(refetchOnWindowFocusOpt !== undefined ? { refetchOnWindowFocus: refetchOnWindowFocusOpt } : {}),
    queryFn: ({ pageParam }) => fetchMeetingsFeedPage(pageParam as number),
    getNextPageParam: (lastPage: Page, allPages: Page[]) => (lastPage.hasMore ? allPages.length : undefined),
  });

  const syncChangedMeetings = useCallback(async () => {
    if (!enabled) return;
    if (meetingListSource() !== 'supabase') {
      await query.refetch();
      return;
    }
    const current = queryClient.getQueryData<FeedInfiniteData>(queryKey);
    const cachedMeetings = flattenPages(current);
    if (cachedMeetings.length === 0) {
      await query.refetch();
      return;
    }

    const summaryLimit = Math.min(400, Math.max(PUBLIC_MEETINGS_PAGE_SIZE, cachedMeetings.length + PUBLIC_MEETINGS_PAGE_SIZE));
    const summariesRes = await fetchPublicMeetingChangeSummaries(summaryLimit);
    if (!summariesRes.ok) return;
    const summaries = summariesRes.summaries;
    const relevantSummaries = summaries.slice(0, summaryLimit);
    const { changedIds, deletedIds } = diffMeetingSummaries(cachedMeetings, relevantSummaries);
    if (changedIds.length === 0 && deletedIds.length === 0) return;

    const changedRes = await fetchMeetingsForSyncByIds(changedIds);
    if (!changedRes.ok) return;
    const nextMeetings = mergeMeetingsBySummaries(cachedMeetings, relevantSummaries, changedRes.meetings).slice(
      0,
      Math.max(cachedMeetings.length, PUBLIC_MEETINGS_PAGE_SIZE),
    );

    queryClient.setQueryData<FeedInfiniteData>(queryKey, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: buildPagesFromMeetings(nextMeetings, prev.pages.length, summaries.length),
      };
    });
  }, [enabled, query, queryClient, queryKey]);

  useEffect(() => {
    if (!enabled) return;
    if (meetingListSource() !== 'supabase') return;
    const unsub = subscribePublicMeetingsListInvalidate(
      () => {
        void syncChangedMeetings();
      },
      () => {
        /* Realtime 오류는 피드에서 별도 배너 없이 무시 가능 */
      },
    );
    return () => {
      unsub();
    };
  }, [enabled, syncChangedMeetings]);

  const meetings = useMemo(() => flattenPages(query.data as FeedInfiniteData | undefined), [query.data]);

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
    syncChangedMeetings,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    showFooterSpinner,
    /** 초기 데이터 없음 + 아직 첫 응답 전 — 빈 상태·에러 박스 게이트용 */
    isInitialListLoading: query.isPending && meetings.length === 0,
  };
}
