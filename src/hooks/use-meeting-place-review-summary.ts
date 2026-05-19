import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  fetchMeetingPlaceReviewSummary,
  meetingPlaceReviewSummaryQueryKey,
  type MeetingReviewSummary,
} from '@/src/lib/meeting-review/meeting-review-api';
import { startPostgresRealtimeSubscription } from '@/src/lib/supabase-realtime-resilience';

const STALE_MS = 3000;

export type UseMeetingPlaceReviewSummaryOptions = {
  enabled?: boolean;
};

export function useMeetingPlaceReviewSummary(
  meetingId: string,
  appUserId: string | null | undefined,
  opts?: UseMeetingPlaceReviewSummaryOptions,
) {
  const mid = meetingId.trim();
  const uid = appUserId?.trim() ?? '';
  const queryClient = useQueryClient();
  const enabled = Boolean(mid && uid) && (opts?.enabled !== false);

  const query = useQuery({
    queryKey: meetingPlaceReviewSummaryQueryKey(mid),
    queryFn: async (): Promise<MeetingReviewSummary> => {
      const res = await fetchMeetingPlaceReviewSummary(mid, uid);
      if (!res.ok) throw new Error(res.message);
      return res.summary;
    },
    enabled,
    staleTime: STALE_MS,
    gcTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const stopRealtime = startPostgresRealtimeSubscription({
      channelBaseName: 'meeting-review',
      uniqueKey: mid,
      configure: (ch) => {
        ch.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'meeting_reviews',
            filter: `meeting_id=eq.${mid}`,
          },
          () => {
            void queryClient.invalidateQueries({ queryKey: meetingPlaceReviewSummaryQueryKey(mid) });
          },
        );
      },
      shouldStop: () => stopped,
      logLabel: 'meeting-place-review-summary',
      userErrorMessage: '모임 장소 리뷰 요약 실시간 연결 오류',
    });

    return () => {
      stopped = true;
      stopRealtime();
    };
  }, [enabled, mid, queryClient]);

  return query;
}
