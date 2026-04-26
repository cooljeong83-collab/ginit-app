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
  console.log('📡 모임 목록: 서버 데이터 20개 가져오기 (Page: ' + pageParam + ')');
  const res = await fetchPublicMeetingsPageFromSupabase(pageParam);
  if (!res.ok) throw new Error(res.message);
  return { meetings: res.meetings, hasMore: res.hasMore };
}

export function useMeetingsFeedInfiniteQuery() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('📦 모임 목록: 로컬 캐시 로드 시도');
  }, []);

  useEffect(() => {
    if (meetingListSource() !== 'supabase') return;
    let updateDebounce: ReturnType<typeof setTimeout> | null = null;
    const flushInvalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['meetings', 'feed'] });
    };
    const unsub = subscribePublicMeetingsListInvalidate(
      (payload) => {
        /**
         * `meetings` 행의 UPDATE는 채팅 읽음·부분 필드만 바뀌는 경우가 많아,
         * 즉시 무효화하면 채팅방 진입만으로도 피드가 매번 서버 재조회됩니다.
         * INSERT/DELETE는 목록 구성에 직접 영향 → 즉시 무효화.
         */
        if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
          if (updateDebounce) {
            clearTimeout(updateDebounce);
            updateDebounce = null;
          }
          flushInvalidate();
          return;
        }
        if (updateDebounce) clearTimeout(updateDebounce);
        updateDebounce = setTimeout(() => {
          updateDebounce = null;
          flushInvalidate();
        }, 2000);
      },
      () => {
        /* Realtime 오류는 피드에서 별도 배너 없이 무시 가능 */
      },
    );
    return () => {
      unsub();
      if (updateDebounce) clearTimeout(updateDebounce);
    };
  }, [queryClient]);

  const queryKey = useMemo(() => meetingsFeedInfiniteQueryKey(), []);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
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
