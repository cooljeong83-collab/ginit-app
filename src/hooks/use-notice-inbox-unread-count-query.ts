import { useQuery } from '@tanstack/react-query';

import { countMyNoticeInboxUnread, NOTICES_QUERY_KEY_ROOT } from '@/src/features/notices/notices-api';

export function noticeInboxUnreadCountQueryKey() {
  return [...NOTICES_QUERY_KEY_ROOT, 'inbox', 'unread-count'] as const;
}

export function useNoticeInboxUnreadCountQuery(enabled = true) {
  return useQuery({
    queryKey: noticeInboxUnreadCountQueryKey(),
    enabled,
    queryFn: countMyNoticeInboxUnread,
    staleTime: 30_000,
  });
}
