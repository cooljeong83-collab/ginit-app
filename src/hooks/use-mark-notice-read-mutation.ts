import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  markNoticeInboxRead,
  markNoticeInboxReadByNoticeId,
  NOTICES_QUERY_KEY_ROOT,
} from '@/src/features/notices/notices-api';
import { noticeInboxUnreadCountQueryKey } from '@/src/hooks/use-notice-inbox-unread-count-query';
import { noticeInboxQueryKey } from '@/src/hooks/use-notice-inbox-infinite-query';
import { activeNoticesQueryKey } from '@/src/hooks/use-active-notices-query';

function invalidateNoticeQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: NOTICES_QUERY_KEY_ROOT });
  void qc.invalidateQueries({ queryKey: noticeInboxUnreadCountQueryKey() });
  void qc.invalidateQueries({ queryKey: noticeInboxQueryKey() });
  void qc.invalidateQueries({ queryKey: activeNoticesQueryKey('home_banner') });
  void qc.invalidateQueries({ queryKey: activeNoticesQueryKey('popup') });
}

export function useMarkNoticeInboxReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { inboxId?: string; noticeId?: string }) => {
      if (args.inboxId?.trim()) {
        await markNoticeInboxRead(args.inboxId);
        return;
      }
      if (args.noticeId?.trim()) {
        await markNoticeInboxReadByNoticeId(args.noticeId);
        return;
      }
      throw new Error('공지를 찾을 수 없어요.');
    },
    onSuccess: () => invalidateNoticeQueries(qc),
  });
}
