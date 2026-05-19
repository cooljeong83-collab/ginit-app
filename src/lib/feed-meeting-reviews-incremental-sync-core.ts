import type { QueryClient } from '@tanstack/react-query';

import { performFeedMeetingReviewsSurgicalSync } from '@/src/lib/feed-meeting-reviews-sync-service';

export type FeedMeetingReviewsSyncOutcome = 'updated' | 'unchanged' | 'refetched' | 'failed' | 'skipped';

/**
 * 탐색 피드 후기 캐러셀 — persisted TanStack 캐시 증분 동기화(모임 `applyPublicMeetingsFeedSummarySync`와 동일 패턴).
 */
export async function applyFeedMeetingReviewsSummarySync(
  queryClient: QueryClient,
  regionNorm: string,
): Promise<FeedMeetingReviewsSyncOutcome> {
  const region = regionNorm.trim();
  if (!region) return 'skipped';

  const r = await performFeedMeetingReviewsSurgicalSync(queryClient, region, {
    refetchWhenCacheEmpty: true,
  });
  if (r.status === 'failed') return 'failed';
  if (r.status === 'skipped') return 'skipped';
  if (r.refetchedEmpty) return 'refetched';
  return r.patchedAny ? 'updated' : 'unchanged';
}
