import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MeetingChatFetchedMessagesPage, MeetingChatLiveTailEvent, MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  fetchMeetingChatLatestPage,
  fetchMeetingChatOlderPageAfterMessageId,
  meetingChatMessageDescComparator,
  MEETING_CHAT_PAGE_SIZE,
  subscribeMeetingChatLiveTail,
} from '@/src/lib/meeting-chat';

const CHAT_MESSAGES_STALE_MS = 5 * 60 * 1000;

export function meetingChatMessagesQueryKey(meetingId: string) {
  return ['meeting-chat', 'messages', meetingId] as const;
}

function page0FromTailEvent(
  e: MeetingChatLiveTailEvent,
  prevP0: MeetingChatFetchedMessagesPage | undefined,
): MeetingChatFetchedMessagesPage {
  const tailIds = new Set(e.tail.map((m) => m.id));
  const evicted = e.evictedFromTail.filter((m) => !tailIds.has(m.id));
  evicted.sort(meetingChatMessageDescComparator);
  const messages = [...e.tail, ...evicted];
  return {
    messages,
    oldestMessageId: messages.length ? messages[messages.length - 1]!.id : null,
    hasMore:
      e.evictedFromTail.length > 0 ? Boolean(prevP0?.hasMore) : e.tail.length >= MEETING_CHAT_PAGE_SIZE,
  };
}

function mergeLiveTailIntoInfiniteData(
  old: InfiniteData<MeetingChatFetchedMessagesPage> | undefined,
  e: MeetingChatLiveTailEvent,
): InfiniteData<MeetingChatFetchedMessagesPage> {
  const newP0 = page0FromTailEvent(e, old?.pages[0]);
  if (!old) {
    return { pageParams: [null], pages: [newP0] };
  }
  return {
    pageParams: old.pageParams,
    pages: [newP0, ...old.pages.slice(1)],
  };
}

function countDistinctMessagesInInfiniteData(
  data: InfiniteData<MeetingChatFetchedMessagesPage> | undefined,
): number {
  if (!data?.pages?.length) return 0;
  const seen = new Set<string>();
  for (const p of data.pages) {
    for (const m of p.messages) {
      seen.add(m.id);
    }
  }
  return seen.size;
}

/** infinite 캐시를 `messages` 배열과 동일 규칙(중복 제거·페이지 순)으로 평탄화 */
export function flattenMeetingChatInfinitePages(
  data: InfiniteData<MeetingChatFetchedMessagesPage> | undefined,
): MeetingChatMessage[] {
  const pages = data?.pages ?? [];
  const seen = new Set<string>();
  const out: MeetingChatMessage[] = [];
  for (const p of pages) {
    for (const m of p.messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/**
 * 검색 점프용으로 가져온 과거 `extra` 페이지들을 `InfiniteData` 끝에 붙입니다.
 * `pageParams[i]`는 `pages[i]`를 가져올 때 사용한 커서(직전 페이지의 `oldestMessageId`)와 동일해야 합니다.
 */
export function mergeMeetingChatInfiniteAppendPages(
  old: InfiniteData<MeetingChatFetchedMessagesPage> | undefined,
  extra: MeetingChatFetchedMessagesPage[],
): InfiniteData<MeetingChatFetchedMessagesPage> | undefined {
  if (!old?.pages?.length || !extra.length) return old;
  const pageParams = [...old.pageParams];
  const pages = [...old.pages];
  for (const np of extra) {
    const prev = pages[pages.length - 1];
    const cursor = prev?.oldestMessageId?.trim();
    if (!cursor) break;
    pageParams.push(cursor);
    pages.push(np);
  }
  return { ...old, pageParams, pages };
}

type UseMeetingChatMessagesInfiniteQueryArgs = {
  meetingId: string;
  enabled: boolean;
};

export function useMeetingChatMessagesInfiniteQuery({ meetingId, enabled }: UseMeetingChatMessagesInfiniteQueryArgs) {
  const queryClient = useQueryClient();
  const didAnnounceCacheRef = useRef<string | null>(null);
  /** `onEndReached`가 연속 호출될 때 `isFetchingNextPage` 갱신 전 중복 요청 방지 */
  const olderPrefetchLockRef = useRef(false);

  const queryKey = useMemo(() => meetingChatMessagesQueryKey(meetingId), [meetingId]);

  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(meetingId.trim()) && enabled,
    initialPageParam: null as string | null,
    staleTime: CHAT_MESSAGES_STALE_MS,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const mid = meetingId.trim();
      if (!mid) {
        return { messages: [], oldestMessageId: null, hasMore: false };
      }
      if (pageParam === null) {
        // eslint-disable-next-line no-console
        console.log('📡 채팅방: 새 메시지 20개 동기화 중...');
        return fetchMeetingChatLatestPage(mid);
      }
      return fetchMeetingChatOlderPageAfterMessageId(mid, pageParam);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.oldestMessageId ? lastPage.oldestMessageId : undefined,
  });

  const messages = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const flat = pages.flatMap((p) => p.messages);
    const seen = new Set<string>();
    const out: MeetingChatMessage[] = [];
    for (const m of flat) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [query.data]);

  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    didAnnounceCacheRef.current = null;
    olderPrefetchLockRef.current = false;
  }, [meetingId]);

  useEffect(() => {
    if (!enabled || !meetingId.trim()) return;
    const mid = meetingId.trim();
    if (didAnnounceCacheRef.current === mid) return;
    if (messages.length === 0 || !query.isSuccess) return;
    didAnnounceCacheRef.current = mid;
    // eslint-disable-next-line no-console
    console.log('📂 채팅방: 캐시된 메시지 로드 완료');
  }, [enabled, meetingId, messages.length, query.isSuccess]);

  useEffect(() => {
    if (!enabled || !meetingId.trim() || !query.isSuccess) {
      return;
    }
    const mid = meetingId.trim();
    const unsub = subscribeMeetingChatLiveTail(
      mid,
      (e) => {
        setLiveError(null);
        queryClient.setQueryData(
          meetingChatMessagesQueryKey(mid),
          (old: InfiniteData<MeetingChatFetchedMessagesPage> | undefined) => mergeLiveTailIntoInfiniteData(old, e),
        );
      },
      (msg) => setLiveError(msg),
    );
    return unsub;
  }, [enabled, meetingId, query.isSuccess, queryClient]);

  const listError =
    liveError ??
    (query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null);

  const clearListError = useCallback(() => setLiveError(null), []);

  const { fetchNextPage: rqFetchNextPage, hasNextPage: rqHasNextPage, isFetchingNextPage: rqIsFetchingNextPage } =
    query;

  const fetchNextPagePrefetched = useCallback(async () => {
    if (!rqHasNextPage || rqIsFetchingNextPage || olderPrefetchLockRef.current) return;
    olderPrefetchLockRef.current = true;
    try {
      // eslint-disable-next-line no-console
      console.log('⬆️ 채팅 상단 도달 전: 이전 메시지 20개 미리 가져오기 시작');
      await rqFetchNextPage();
      const data = queryClient.getQueryData<InfiniteData<MeetingChatFetchedMessagesPage>>(queryKey);
      const n = countDistinctMessagesInInfiniteData(data);
      // eslint-disable-next-line no-console
      console.log('✅ 현재 로드된 총 메시지 수: ' + n);
    } finally {
      olderPrefetchLockRef.current = false;
    }
  }, [rqFetchNextPage, rqHasNextPage, rqIsFetchingNextPage, queryClient, queryKey]);

  return {
    messages,
    listError,
    clearListError,
    fetchNextPage: fetchNextPagePrefetched,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    isInitialLoading: query.isPending && messages.length === 0,
    refetch: query.refetch,
  };
}
