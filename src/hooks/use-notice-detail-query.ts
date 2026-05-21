import { useQuery } from '@tanstack/react-query';

import { getNoticeDetailForMe, NOTICES_QUERY_KEY_ROOT } from '@/src/features/notices/notices-api';

export function noticeDetailQueryKey(noticeId: string) {
  return [...NOTICES_QUERY_KEY_ROOT, 'detail', noticeId] as const;
}

export function useNoticeDetailQuery(noticeId: string | null, enabled = true) {
  const id = noticeId?.trim() ?? '';
  return useQuery({
    queryKey: noticeDetailQueryKey(id),
    enabled: enabled && id.length > 0,
    queryFn: () => getNoticeDetailForMe(id),
  });
}
