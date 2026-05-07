import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SocialChatFetchedMessagesPage, SocialChatLiveTailEvent, SocialChatMessage } from '@/src/lib/social-chat-rooms';
import {
  fetchSocialChatLatestPage,
  fetchSocialChatOlderPageAfterMessageId,
  SOCIAL_CHAT_PAGE_SIZE,
  subscribeSocialChatLiveTail,
} from '@/src/lib/social-chat-rooms';

const SOCIAL_CHAT_MESSAGES_STALE_MS = 5 * 60 * 1000;

export function socialChatMessagesQueryKey(roomId: string) {
  return ['social-chat', 'messages', roomId] as const;
}

function page0FromTailEvent(
  e: SocialChatLiveTailEvent,
  prevP0: SocialChatFetchedMessagesPage | undefined,
): SocialChatFetchedMessagesPage {
  // tailDesc는 최신→과거. UI는 chrono(오래된→최신)를 쓰므로 뒤집어서 저장합니다.
  const tailDescIds = new Set(e.tailDesc.map((m) => m.id));
  const evicted = e.evictedFromTailDesc.filter((m) => !tailDescIds.has(m.id));
  const mergedDesc = [...e.tailDesc, ...evicted];
  const mergedChrono = [...mergedDesc].reverse();
  return {
    messages: mergedChrono,
    oldestMessageId: mergedChrono.length ? mergedChrono[0]!.id : null,
    hasMore: mergedDesc.length >= SOCIAL_CHAT_PAGE_SIZE ? Boolean(prevP0?.hasMore ?? true) : false,
  };
}

function mergeLiveTailIntoInfiniteData(
  old: InfiniteData<SocialChatFetchedMessagesPage> | undefined,
  e: SocialChatLiveTailEvent,
): InfiniteData<SocialChatFetchedMessagesPage> {
  const newP0 = page0FromTailEvent(e, old?.pages[0]);
  if (!old) return { pageParams: [null], pages: [newP0] };
  return { pageParams: old.pageParams, pages: [newP0, ...old.pages.slice(1)] };
}

/** infinite 캐시를 chrono(오래된→최신) 순서로 평탄화 */
export function flattenSocialChatInfinitePages(
  data: InfiniteData<SocialChatFetchedMessagesPage> | undefined,
): SocialChatMessage[] {
  const pages = data?.pages ?? [];
  if (pages.length === 0) return [];
  const seen = new Set<string>();
  const out: SocialChatMessage[] = [];
  // pages[0]이 "최신 페이지"이므로, chrono로는 역순으로 합쳐야 합니다.
  for (const p of [...pages].reverse()) {
    for (const m of p.messages) {
      if (!m.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** 검색 점프 등으로 가져온 과거 페이지들을 infinite 캐시 끝(더 과거)에 붙입니다. */
export function mergeSocialChatInfiniteAppendPages(
  old: InfiniteData<SocialChatFetchedMessagesPage> | undefined,
  extra: SocialChatFetchedMessagesPage[],
): InfiniteData<SocialChatFetchedMessagesPage> | undefined {
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

type UseSocialChatMessagesInfiniteQueryArgs = {
  roomId: string;
  enabled: boolean;
};

export function useSocialChatMessagesInfiniteQuery({ roomId, enabled }: UseSocialChatMessagesInfiniteQueryArgs) {
  const queryClient = useQueryClient();
  const olderPrefetchLockRef = useRef(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const queryKey = useMemo(() => socialChatMessagesQueryKey(roomId), [roomId]);

  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(roomId.trim()) && enabled,
    initialPageParam: null as string | null,
    staleTime: SOCIAL_CHAT_MESSAGES_STALE_MS,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const rid = roomId.trim();
      if (!rid) return { messages: [], oldestMessageId: null, hasMore: false };
      if (pageParam === null) return fetchSocialChatLatestPage(rid);
      return fetchSocialChatOlderPageAfterMessageId(rid, pageParam);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.oldestMessageId ? lastPage.oldestMessageId : undefined,
  });

  const messages = useMemo(() => flattenSocialChatInfinitePages(query.data), [query.data]);

  useEffect(() => {
    setLiveError(null);
    olderPrefetchLockRef.current = false;
  }, [roomId]);

  useEffect(() => {
    if (!enabled || !roomId.trim() || !query.isSuccess) return;
    const rid = roomId.trim();
    const unsub = subscribeSocialChatLiveTail(
      rid,
      (e) => {
        setLiveError(null);
        queryClient.setQueryData(
          socialChatMessagesQueryKey(rid),
          (old: InfiniteData<SocialChatFetchedMessagesPage> | undefined) => mergeLiveTailIntoInfiniteData(old, e),
        );
      },
      (msg) => setLiveError(msg),
    );
    return unsub;
  }, [enabled, roomId, query.isSuccess, queryClient]);

  const listError =
    liveError ?? (query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null);

  const clearListError = useCallback(() => setLiveError(null), []);

  const fetchNextPagePrefetched = useCallback(async () => {
    if (!query.hasNextPage || query.isFetchingNextPage || olderPrefetchLockRef.current) return;
    olderPrefetchLockRef.current = true;
    try {
      await query.fetchNextPage();
    } finally {
      olderPrefetchLockRef.current = false;
    }
  }, [query]);

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

