import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';
import {
  dedupeFeedMeetingReviewsByMeetingId,
  feedMeetingReviewsQueryKey,
  type FeedMeetingReviewCarouselItem,
} from '@/src/lib/feed-meeting-reviews-api';
import { shuffleFeedMeetingReviewsForDisplay } from '@/src/lib/feed-meeting-reviews-display-order';
import { applyFeedMeetingReviewsSummarySync } from '@/src/lib/feed-meeting-reviews-incremental-sync-core';
import { runFeedMeetingReviewsDeltaSync } from '@/src/lib/feed-meeting-reviews-sync-service';

const EMPTY_REVIEWS: FeedMeetingReviewCarouselItem[] = [];

export type UseFeedMeetingReviewsForRegionOptions = {
  enabled?: boolean;
};

/**
 * 탐색 피드 후기 — PersistQueryClient 복원 후 로컬 캐시 우선, 증분 RPC로 갱신.
 */
export function useFeedMeetingReviewsForRegion(
  regionNorm: string,
  opts?: UseFeedMeetingReviewsForRegionOptions,
) {
  const region = useMemo(() => normalizeFeedRegionLabel(regionNorm), [regionNorm]);
  const enabled = Boolean(region) && (opts?.enabled !== false);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => feedMeetingReviewsQueryKey(region), [region]);
  const didAttemptEmptySyncRef = useRef(false);
  const [displayShuffleSeed, setDisplayShuffleSeed] = useState(() => Math.random());

  useEffect(() => {
    didAttemptEmptySyncRef.current = false;
    setDisplayShuffleSeed(Math.random());
  }, [region]);

  const query = useQuery<FeedMeetingReviewCarouselItem[]>({
    queryKey,
    enabled,
    queryFn: async () => {
      await applyFeedMeetingReviewsSummarySync(queryClient, region);
      return queryClient.getQueryData<FeedMeetingReviewCarouselItem[]>(queryKey) ?? EMPTY_REVIEWS;
    },
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.state.data !== undefined ? previousData : undefined,
  });

  const syncChangedReviews = useCallback(async () => {
    if (!enabled || !region) return;
    await applyFeedMeetingReviewsSummarySync(queryClient, region);
    await queryClient.invalidateQueries({ queryKey });
  }, [enabled, queryClient, queryKey, region]);

  const runDeltaSync = useCallback(
    async (reason: 'pull_refresh' | 'foreground') => {
      if (!enabled || !region) return;
      await runFeedMeetingReviewsDeltaSync(queryClient, region, reason);
      await queryClient.invalidateQueries({ queryKey });
    },
    [enabled, queryClient, queryKey, region],
  );

  useEffect(() => {
    if (!enabled || !region) return;
    const cached = queryClient.getQueryData<FeedMeetingReviewCarouselItem[]>(queryKey) ?? EMPTY_REVIEWS;
    if (cached.length > 0) {
      void syncChangedReviews();
      return;
    }
    if (didAttemptEmptySyncRef.current) return;
    didAttemptEmptySyncRef.current = true;
    void syncChangedReviews();
  }, [enabled, queryClient, queryKey, region, syncChangedReviews]);

  const dataUpdatedAt = query.dataUpdatedAt;

  useEffect(() => {
    if (!enabled || dataUpdatedAt <= 0) return;
    setDisplayShuffleSeed(Math.random());
  }, [dataUpdatedAt, enabled]);

  const reviews = useMemo(() => {
    if (!enabled) return EMPTY_REVIEWS;
    const deduped = dedupeFeedMeetingReviewsByMeetingId(query.data ?? EMPTY_REVIEWS);
    return shuffleFeedMeetingReviewsForDisplay(deduped, displayShuffleSeed);
  }, [displayShuffleSeed, enabled, query.data]);

  return {
    reviews,
    syncChangedReviews,
    runDeltaSync,
    isInitialLoading: enabled && query.isPending && reviews.length === 0,
  };
}
