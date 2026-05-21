import { useInfiniteQuery } from '@tanstack/react-query';

import { listMyNoticeInbox, NOTICES_QUERY_KEY_ROOT } from '@/src/features/notices/notices-api';

const PAGE_SIZE = 25;

export function noticeInboxQueryKey() {
  return [...NOTICES_QUERY_KEY_ROOT, 'inbox'] as const;
}

export function useNoticeInboxInfiniteQuery(enabled = true) {
  return useInfiniteQuery({
    queryKey: noticeInboxQueryKey(),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listMyNoticeInbox({ limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
