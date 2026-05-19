/**
 * 탐색 피드 후기 캐러셀 — TanStack Query 캐시 전용(모임 목록 `meeting-sync-service`와 동일 계열).
 */
import type { QueryClient } from '@tanstack/react-query';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';
import { recordMeetingsListPageFetchedFromNetwork } from '@/src/lib/meetings-feed-deferred-sync';
import {
  FEED_MEETING_REVIEWS_CAROUSEL_LIMIT,
  feedMeetingReviewsQueryKey,
  normalizeFeedMeetingReviewCarouselItem,
  fetchFeedMeetingReviewsForRegion,
  maxFeedMeetingReviewCreatedAtIso,
  type FeedMeetingReviewCarouselItem,
} from '@/src/lib/feed-meeting-reviews-api';
import { setFeedMeetingReviewsLastSyncIso } from '@/src/lib/feed-meeting-reviews-sync-last-at-storage';

export type PerformFeedMeetingReviewsSurgicalSyncOptions = {
  /** 캐시가 비었을 때 전체 목록 RPC로 채움 */
  refetchWhenCacheEmpty?: boolean;
};

export type PerformFeedMeetingReviewsSurgicalSyncResult =
  | { status: 'ok'; refetchedEmpty: boolean; patchedAny: boolean }
  | { status: 'failed' }
  | { status: 'skipped' };

function getCachedReviews(
  queryClient: QueryClient,
  regionNorm: string,
): FeedMeetingReviewCarouselItem[] {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return [];
  return queryClient.getQueryData<FeedMeetingReviewCarouselItem[]>(feedMeetingReviewsQueryKey(region)) ?? [];
}

function setCachedReviews(
  queryClient: QueryClient,
  regionNorm: string,
  reviews: FeedMeetingReviewCarouselItem[],
): void {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return;
  queryClient.setQueryData<FeedMeetingReviewCarouselItem[]>(
    feedMeetingReviewsQueryKey(region),
    reviews.map(normalizeFeedMeetingReviewCarouselItem),
  );
}

/** 서버 pick 규칙(관리자 픽·최대 5건)으로 캐시 전체 갱신 */
async function refreshFeedMeetingReviewsCarouselCache(
  queryClient: QueryClient,
  regionNorm: string,
): Promise<FeedMeetingReviewCarouselItem[]> {
  const region = normalizeFeedRegionLabel(regionNorm);
  const full = await fetchFeedMeetingReviewsForRegion(region, FEED_MEETING_REVIEWS_CAROUSEL_LIMIT);
  setCachedReviews(queryClient, region, full);
  recordMeetingsListPageFetchedFromNetwork();
  await setFeedMeetingReviewsLastSyncIso(
    region,
    full.length > 0 ? maxFeedMeetingReviewCreatedAtIso(full) : new Date().toISOString(),
  );
  return full;
}

export async function performFeedMeetingReviewsSurgicalSync(
  queryClient: QueryClient,
  regionNorm: string,
  options?: PerformFeedMeetingReviewsSurgicalSyncOptions,
): Promise<PerformFeedMeetingReviewsSurgicalSyncResult> {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return { status: 'skipped' };

  const refetchWhenEmpty = options?.refetchWhenCacheEmpty ?? true;
  const cached = getCachedReviews(queryClient, region);

  if (cached.length === 0 && !refetchWhenEmpty) {
    return { status: 'skipped' };
  }

  // 캐러셀 상한 5건 — 전체 RPC 1회로 항상 재구성(정산·feed_region_norm 등 자격 변화는 created_at 증분으로 잡히지 않음).
  try {
    const full = await refreshFeedMeetingReviewsCarouselCache(queryClient, region);
    const refetchedEmpty = cached.length === 0;
    const patchedAny =
      full.length !== cached.length ||
      full.some((row, i) => cached[i]?.reviewId !== row.reviewId);
    return { status: 'ok', refetchedEmpty, patchedAny };
  } catch {
    return { status: 'failed' };
  }
}

export async function runFeedMeetingReviewsDeltaSync(
  queryClient: QueryClient,
  regionNorm: string,
  _reason: 'pull_refresh' | 'foreground',
): Promise<PerformFeedMeetingReviewsSurgicalSyncResult> {
  return performFeedMeetingReviewsSurgicalSync(queryClient, regionNorm, {
    refetchWhenCacheEmpty: true,
  });
}
