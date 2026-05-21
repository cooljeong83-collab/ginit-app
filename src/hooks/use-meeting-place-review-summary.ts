import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  fetchMeetingPlaceReviewSummary,
  meetingPlaceReviewSummaryQueryKey,
  type MeetingReviewSummary,
} from '@/src/lib/meeting-review/meeting-review-api';

/** 캐시 유효 — 명시 invalidate·제출 후 refetch 전까지 서버 재조회 없음 */
const STALE_MS = Number.POSITIVE_INFINITY;
const GC_MS = 30 * 60 * 1000;

export type UseMeetingPlaceReviewSummaryOptions = {
  enabled?: boolean;
  /**
   * true(기본): 화면 포커스마다 캐시를 먼저 보여 주고 RPC 1회 refetch.
   * false: 캐시만 사용(외부 invalidate 시에만 갱신).
   */
  refetchOnFocus?: boolean;
};

/**
 * 모임 장소 후기 써머리 — 로컬퍼스트(TanStack Query 캐시) + 진입 시 1회 fetch.
 * Postgres Changes 실시간 구독 없음.
 */
export function useMeetingPlaceReviewSummary(
  meetingId: string,
  appUserId: string | null | undefined,
  opts?: UseMeetingPlaceReviewSummaryOptions,
) {
  const mid = meetingId.trim();
  const uid = appUserId?.trim() ?? '';
  const queryClient = useQueryClient();
  const enabled = Boolean(mid && uid) && (opts?.enabled !== false);
  const refetchOnFocus = opts?.refetchOnFocus !== false;

  const query = useQuery({
    queryKey: meetingPlaceReviewSummaryQueryKey(mid),
    queryFn: async (): Promise<MeetingReviewSummary> => {
      const res = await fetchMeetingPlaceReviewSummary(mid, uid);
      if (!res.ok) throw new Error(res.message);
      return res.summary;
    },
    enabled,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !refetchOnFocus) return;
      const cached = queryClient.getQueryData<MeetingReviewSummary>(
        meetingPlaceReviewSummaryQueryKey(mid),
      );
      if (cached != null) {
        void query.refetch();
      }
    }, [enabled, refetchOnFocus, mid, queryClient, query.refetch]),
  );

  return query;
}
