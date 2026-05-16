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
import { upsertLocalChatMessages, type OfflineChatLocalMessageInput } from '@/src/lib/offline-chat/offline-chat-sync';
import { voidSafe } from '@/src/lib/void-safe';
import { useLocalMeetingChatMessages } from '@/src/hooks/use-local-chat-room-messages';

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

function messageTimeMs(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

function toLocalInputs(messages: readonly MeetingChatMessage[]): OfflineChatLocalMessageInput[] {
  return messages.map((m) => ({
    messageId: m.id,
    createdAtMs: messageTimeMs(m.createdAt),
    updatedAtMs: messageTimeMs(m.updatedAt) || messageTimeMs(m.createdAt),
    deletedAtMs: messageTimeMs(m.deletedAt) || null,
    senderId: m.senderId,
    senderName: m.senderName ?? null,
    senderAvatarUrl: m.senderAvatarUrl ?? null,
    kind: m.kind,
    text: m.text,
    imageUrl: m.imageUrl,
    imageAlbumBatchId: m.imageAlbumBatchId ?? null,
    replyToMessageId: m.replyTo?.messageId ?? null,
    replyToJson: m.replyTo ? JSON.stringify(m.replyTo) : null,
    linkPreviewJson: m.linkPreview ? JSON.stringify(m.linkPreview) : null,
    rawPayloadJson: null,
  }));
}

/**
 * infinite 캐시 → 화면 `messages`와 동일 규칙(`pages.flatMap` 순서 + id당 첫 등장만 유지).
 * 원글/검색 점프 등 캐시 직접 조회 시에도 훅의 `messages`와 같은 선형 순서를 쓰려면 이 함수만 사용합니다.
 */
export function meetingChatMessagesFromInfiniteData(
  data: InfiniteData<MeetingChatFetchedMessagesPage> | undefined,
): MeetingChatMessage[] {
  const flat = (data?.pages ?? []).flatMap((p) => p.messages);
  const seen = new Set<string>();
  const out: MeetingChatMessage[] = [];
  for (const m of flat) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function mergeMeetingMessagesNewestFirst(
  localMessages: readonly MeetingChatMessage[],
  remoteMessages: readonly MeetingChatMessage[],
): MeetingChatMessage[] {
  if (localMessages.length === 0) return [...remoteMessages];
  if (remoteMessages.length === 0) return [...localMessages];
  const byId = new Map<string, MeetingChatMessage>();
  for (const m of remoteMessages) {
    if (m.id) byId.set(m.id, m);
  }
  for (const m of localMessages) {
    if (m.id) byId.set(m.id, m);
  }
  return [...byId.values()].sort(meetingChatMessageDescComparator);
}

/** infinite 캐시 평탄화 — `meetingChatMessagesFromInfiniteData`와 동일(기존 호출부 호환) */
export function flattenMeetingChatInfinitePages(
  data: InfiniteData<MeetingChatFetchedMessagesPage> | undefined,
): MeetingChatMessage[] {
  return meetingChatMessagesFromInfiniteData(data);
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
  const localMessages = useLocalMeetingChatMessages({ meetingId, enabled: Boolean(meetingId.trim()) });
  const [allowInitialRemoteFetch, setAllowInitialRemoteFetch] = useState(false);

  useEffect(() => {
    setAllowInitialRemoteFetch(false);
    if (!enabled || !meetingId.trim()) return;
    const timer = setTimeout(() => {
      setAllowInitialRemoteFetch(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [enabled, meetingId]);

  useEffect(() => {
    if (localMessages.length > 0) setAllowInitialRemoteFetch(false);
  }, [localMessages.length]);

  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(meetingId.trim()) && enabled && localMessages.length === 0 && allowInitialRemoteFetch,
    initialPageParam: null as string | null,
    staleTime: CHAT_MESSAGES_STALE_MS,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam }) => {
      const mid = meetingId.trim();
      if (!mid) {
        return { messages: [], oldestMessageId: null, hasMore: false };
      }
      if (pageParam === null) {
        console.log('📡 채팅방: 새 메시지 20개 동기화 중...');
        return fetchMeetingChatLatestPage(mid);
      }
      return fetchMeetingChatOlderPageAfterMessageId(mid, pageParam);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.oldestMessageId ? lastPage.oldestMessageId : undefined,
  });

  const remoteMessages = useMemo(() => meetingChatMessagesFromInfiniteData(query.data), [query.data]);
  const messages = useMemo(
    () => mergeMeetingMessagesNewestFirst(localMessages, remoteMessages),
    [localMessages, remoteMessages],
  );

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
    console.log('📂 채팅방: 캐시된 메시지 로드 완료');
  }, [enabled, meetingId, messages.length, query.isSuccess]);

  useEffect(() => {
    if (!enabled || !meetingId.trim()) {
      return;
    }
    const mid = meetingId.trim();
    const unsub = subscribeMeetingChatLiveTail(
      mid,
      (e) => {
        voidSafe(
          (async () => {
            try {
              await upsertLocalChatMessages({ roomType: 'meeting', roomId: mid }, toLocalInputs([...e.tail, ...e.evictedFromTail]));
              setLiveError(null);
              queryClient.setQueryData(
                meetingChatMessagesQueryKey(mid),
                (old: InfiniteData<MeetingChatFetchedMessagesPage> | undefined) => mergeLiveTailIntoInfiniteData(old, e),
              );
            } catch (err) {
              if (__DEV__) console.warn('[useMeetingChatMessagesInfiniteQuery] live tail → local persist failed', err);
            }
          })(),
        );
      },
      (msg) => setLiveError(msg),
    );
    return unsub;
  }, [enabled, meetingId, queryClient]);

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
      console.log('⬆️ 채팅 상단 도달 전: 이전 메시지 20개 미리 가져오기 시작');
      await rqFetchNextPage();
      const data = queryClient.getQueryData<InfiniteData<MeetingChatFetchedMessagesPage>>(queryKey);
      const flat = meetingChatMessagesFromInfiniteData(data);
      voidSafe(
        upsertLocalChatMessages({ roomType: 'meeting', roomId: meetingId }, toLocalInputs(flat)),
      );
      const n = countDistinctMessagesInInfiniteData(data);
      console.log('✅ 현재 로드된 총 메시지 수: ' + n);
    } finally {
      olderPrefetchLockRef.current = false;
    }
  }, [meetingId, rqFetchNextPage, rqHasNextPage, rqIsFetchingNextPage, queryClient, queryKey]);

  return {
    messages,
    listError,
    clearListError,
    fetchNextPage: fetchNextPagePrefetched,
    hasNextPage: Boolean(query.hasNextPage),
    isFetchingNextPage: query.isFetchingNextPage,
    isInitialLoading: false,
    refetch: query.refetch,
  };
}
