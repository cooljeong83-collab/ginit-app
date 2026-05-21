import { useQuery } from '@tanstack/react-query';

import {
  listActiveNoticesForMe,
  NOTICES_QUERY_KEY_ROOT,
  type NoticeChannel,
} from '@/src/features/notices/notices-api';

export function activeNoticesQueryKey(channel: NoticeChannel) {
  return [...NOTICES_QUERY_KEY_ROOT, 'active', channel] as const;
}

export function useActiveNoticesQuery(channel: NoticeChannel, enabled = true) {
  return useQuery({
    queryKey: activeNoticesQueryKey(channel),
    enabled,
    queryFn: () => listActiveNoticesForMe(channel),
    staleTime: 60_000,
  });
}
