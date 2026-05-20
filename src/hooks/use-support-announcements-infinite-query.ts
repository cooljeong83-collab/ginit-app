import { useInfiniteQuery } from '@tanstack/react-query';

import { listPublishedAnnouncements } from '@/src/features/support/support-announcements-api';

const PAGE_SIZE = 20;

export function supportAnnouncementsQueryKey() {
  return ['support', 'announcements', 'published'] as const;
}

export function useSupportAnnouncementsInfiniteQuery(enabled = true) {
  return useInfiniteQuery({
    queryKey: supportAnnouncementsQueryKey(),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listPublishedAnnouncements({ limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
