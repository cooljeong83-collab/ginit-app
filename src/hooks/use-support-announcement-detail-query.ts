import { useQuery } from '@tanstack/react-query';

import { getPublishedAnnouncement } from '@/src/features/support/support-announcements-api';

export function supportAnnouncementDetailQueryKey(id: string) {
  return ['support', 'announcements', 'detail', id] as const;
}

export function useSupportAnnouncementDetailQuery(announcementId: string | null) {
  const id = announcementId?.trim() ?? '';
  return useQuery({
    queryKey: supportAnnouncementDetailQueryKey(id),
    enabled: Boolean(id),
    queryFn: () => getPublishedAnnouncement(id),
  });
}
