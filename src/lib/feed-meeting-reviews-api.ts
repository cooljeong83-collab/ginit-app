import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';
import { parseFeedReviewCommentsField } from '@/src/lib/feed-meeting-review-comments-parse';
import {
  isFeedMeetingReviewsRpcPayloadUnexpected,
  parseFeedMeetingReviewsRpcJsonbRows,
} from '@/src/lib/feed-meeting-reviews-rpc-parse';
import { supabase } from '@/src/lib/supabase';

export {
  isFeedMeetingReviewsRpcEmptyPayload,
  isFeedMeetingReviewsRpcPayloadUnexpected,
  parseFeedMeetingReviewsRpcJsonbRows,
} from '@/src/lib/feed-meeting-reviews-rpc-parse';

export { parseFeedReviewCommentsField } from '@/src/lib/feed-meeting-review-comments-parse';

/** 피드 후기 캐러셀 — 서버 `list_feed_meeting_reviews_for_region` 상한 */
export const FEED_MEETING_REVIEWS_LOOKBACK_DAYS = 7;

/**
 * 탐색 피드 후기 캐러셀 노출 조건 (`list_feed_meeting_reviews_for_region`):
 * - 선택 관심 지역 ↔ feed_region_norm 또는 주소·장소 haystack (작성자·참여 필터 없음)
 * - meeting_reviews.created_at 최근 {@link FEED_MEETING_REVIEWS_LOOKBACK_DAYS}일
 * - meetings.is_public, 정산 완료(SETTLED) — 코멘트 없어도 노출
 * - admin_pick 우선(복수 시 무작위) + 나머지 무작위 보충, 모임당 1카드·최대 5장
 */
export type FeedMeetingReviewCarouselItem = {
  reviewId: string;
  meetingId: string;
  placeName: string;
  /** 해당 후기 1건 별점(레거시·동기화 호환) */
  rating: number;
  /** 모임 후기 평균 별점 — 카드 노출용 */
  avgRating: number;
  comment: string;
  /** 동일 모임의 비어 있지 않은 코멘트 전체(카드 내 전광판) */
  comments: string[];
  createdAt: string;
  photoUrl: string | null;
  regionNorm: string | null;
  adminPick?: boolean;
  locationLabel: string | null;
  participantFirstName: string | null;
  participantCount: number;
};

/**
 * 서버 권장: `list_feed_meeting_reviews_for_region` RPC에서
 * region_norm 일치 + **meeting_id당 1건** + 관리자 픽 우선(무작위) + 최신순 보충 + limit(최대 5).
 *
 * 클라이언트 폴백(소량·디버그만):
 * reviews
 *   .filter((r) => normalizeFeedRegionLabel(r.regionNorm ?? '') === selectedRegion)
 *   .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
 */
export function feedMeetingReviewsQueryKey(
  regionNorm: string,
): readonly ['feed', 'meeting-reviews', string, 'v2'] {
  return ['feed', 'meeting-reviews', normalizeFeedRegionLabel(regionNorm), 'v2'] as const;
}

export type FeedMeetingReviewChangeSummary = {
  reviewId: string;
  meetingId: string;
  createdAt: string;
  updatedFp: string;
};

/** 피드 캐러셀 최대 노출 건수 — 서버 RPC 상한과 동일 */
export const FEED_MEETING_REVIEWS_CAROUSEL_LIMIT = 5;

/** Persisted TanStack 캐시 등 레거시 행 — 카드·RPC 신규 필드 기본값 보정 */
export function normalizeFeedMeetingReviewCarouselItem(
  item: FeedMeetingReviewCarouselItem,
): FeedMeetingReviewCarouselItem {
  const rating =
    typeof item.rating === 'number' && Number.isFinite(item.rating)
      ? Math.min(5, Math.max(1, item.rating))
      : 1;
  const avgRaw = item.avgRating;
  const avgRating =
    typeof avgRaw === 'number' && Number.isFinite(avgRaw)
      ? Math.min(5, Math.max(1, avgRaw))
      : rating;
  const participantCount =
    typeof item.participantCount === 'number' && Number.isFinite(item.participantCount)
      ? Math.max(0, Math.trunc(item.participantCount))
      : 0;
  const photoRaw = typeof item.photoUrl === 'string' ? item.photoUrl.trim() : '';
  const commentFallback = typeof item.comment === 'string' ? item.comment.trim() : '';
  const comments = parseFeedReviewCommentsField(item.comments, commentFallback);
  return {
    ...item,
    rating,
    avgRating,
    comment: commentFallback || comments[0] || '',
    comments,
    locationLabel: item.locationLabel?.trim() || null,
    participantFirstName: item.participantFirstName?.trim() || null,
    participantCount,
    photoUrl: photoRaw.startsWith('https://') ? photoRaw : null,
  };
}

export function sortFeedMeetingReviewsNewestFirst(
  items: readonly FeedMeetingReviewCarouselItem[],
): FeedMeetingReviewCarouselItem[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function feedReviewRowRank(row: FeedMeetingReviewCarouselItem): number {
  const t = Date.parse(row.createdAt);
  return (row.adminPick ? 1_000_000_000_000_000 : 0) + (Number.isFinite(t) ? t : 0);
}

/** 모임당 카드 1장 — 관리자 픽·최신 코멘트 우선 */
export function dedupeFeedMeetingReviewsByMeetingId(
  items: readonly FeedMeetingReviewCarouselItem[],
  limit = FEED_MEETING_REVIEWS_CAROUSEL_LIMIT,
): FeedMeetingReviewCarouselItem[] {
  const byMeeting = new Map<string, FeedMeetingReviewCarouselItem>();
  for (const raw of items) {
    const row = normalizeFeedMeetingReviewCarouselItem(raw);
    const key = row.meetingId.trim();
    if (!key) continue;
    const prev = byMeeting.get(key);
    if (!prev || feedReviewRowRank(row) > feedReviewRowRank(prev)) {
      byMeeting.set(key, row);
    }
  }
  return sortFeedMeetingReviewsNewestFirst([...byMeeting.values()]).slice(0, limit);
}

export function mergeFeedMeetingReviewCarouselItems(
  existing: readonly FeedMeetingReviewCarouselItem[],
  incoming: readonly FeedMeetingReviewCarouselItem[],
  limit = FEED_MEETING_REVIEWS_CAROUSEL_LIMIT,
): FeedMeetingReviewCarouselItem[] {
  return dedupeFeedMeetingReviewsByMeetingId([...incoming, ...existing], limit);
}

export function maxFeedMeetingReviewCreatedAtIso(items: readonly FeedMeetingReviewCarouselItem[]): string {
  let ms = Date.now();
  for (const row of items) {
    const t = Date.parse(row.createdAt);
    if (Number.isFinite(t) && t > ms) ms = t;
  }
  return new Date(ms).toISOString();
}

/** 증분 요약에 포함된 review_id — 워터마크 이후 행(대부분 신규 insert) */
export function feedMeetingReviewIdsFromSummaries(
  summaries: readonly FeedMeetingReviewChangeSummary[],
): string[] {
  return [...new Set(summaries.map((s) => s.reviewId.trim()).filter(Boolean))];
}

function parseFeedReviewRow(row: unknown): FeedMeetingReviewCarouselItem | null {
  const r = row as Record<string, unknown>;
  const reviewId = typeof r.review_id === 'string' ? r.review_id.trim() : '';
  const meetingId = typeof r.meeting_id === 'string' ? r.meeting_id.trim() : '';
  if (!reviewId || !meetingId) return null;
  const ratingRaw = r.rating;
  const rating =
    typeof ratingRaw === 'number' ? ratingRaw : typeof ratingRaw === 'string' ? Number(ratingRaw) : 0;
  const comment = typeof r.comment === 'string' ? r.comment.trim() : '';
  const photoRaw = typeof r.photo_url === 'string' ? r.photo_url.trim() : '';
  const avgRaw = r.avg_rating;
  const avgRating =
    typeof avgRaw === 'number'
      ? avgRaw
      : typeof avgRaw === 'string'
        ? Number(avgRaw)
        : rating;
  const participantCountRaw = r.participant_count;
  const participantCount =
    typeof participantCountRaw === 'number'
      ? participantCountRaw
      : typeof participantCountRaw === 'string'
        ? Number(participantCountRaw)
        : 0;
  const locationRaw = typeof r.location_label === 'string' ? r.location_label.trim() : '';
  const participantFirstRaw =
    typeof r.participant_first_name === 'string' ? r.participant_first_name.trim() : '';
  const commentsParsed = parseFeedReviewCommentsField(r.comments, comment);
  return normalizeFeedMeetingReviewCarouselItem({
    reviewId,
    meetingId,
    placeName: typeof r.place_name === 'string' && r.place_name.trim() ? r.place_name.trim() : '장소',
    rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, rating)) : 1,
    avgRating: Number.isFinite(avgRating) ? Math.min(5, Math.max(1, avgRating)) : 1,
    comment,
    comments: commentsParsed,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    photoUrl: photoRaw.startsWith('https://') ? photoRaw : null,
    regionNorm: typeof r.region_norm === 'string' ? r.region_norm.trim() || null : null,
    adminPick: r.admin_pick === true,
    locationLabel: locationRaw || null,
    participantFirstName: participantFirstRaw || null,
    participantCount: Number.isFinite(participantCount) ? Math.max(0, Math.trunc(participantCount)) : 0,
  });
}

export async function fetchFeedMeetingReviewsForRegion(
  regionNorm: string,
  limit = FEED_MEETING_REVIEWS_CAROUSEL_LIMIT,
): Promise<FeedMeetingReviewCarouselItem[]> {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return [];

  const { data, error } = await supabase.rpc('list_feed_meeting_reviews_for_region', {
    p_region_norm: region,
    p_limit: limit,
  });
  if (error) {
    if (__DEV__) console.warn('[fetchFeedMeetingReviewsForRegion]', error.message);
    return [];
  }
  const rows = parseFeedMeetingReviewsRpcJsonbRows(data);
  if (__DEV__ && isFeedMeetingReviewsRpcPayloadUnexpected(data, rows.length)) {
    console.warn('[fetchFeedMeetingReviewsForRegion] unexpected RPC payload', typeof data, data);
  }
  return dedupeFeedMeetingReviewsByMeetingId(
    rows.map(parseFeedReviewRow).filter((row): row is FeedMeetingReviewCarouselItem => row != null),
  );
}

function parseChangeSummaryRow(row: unknown): FeedMeetingReviewChangeSummary | null {
  const r = row as Record<string, unknown>;
  const reviewId = typeof r.review_id === 'string' ? r.review_id.trim() : '';
  const meetingId = typeof r.meeting_id === 'string' ? r.meeting_id.trim() : '';
  const createdAt = typeof r.created_at === 'string' ? r.created_at : '';
  const updatedFp = typeof r.updated_fp === 'string' ? r.updated_fp.trim() : '';
  if (!reviewId || !meetingId || !createdAt || !updatedFp) return null;
  return { reviewId, meetingId, createdAt, updatedFp };
}

export async function fetchFeedMeetingReviewChangeSummariesSince(
  regionNorm: string,
  lastSyncIso: string,
  limit = 100,
): Promise<{ ok: true; summaries: FeedMeetingReviewChangeSummary[] } | { ok: false; message: string }> {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return { ok: true, summaries: [] };

  const { data, error } = await supabase.rpc('list_feed_meeting_review_change_summaries', {
    p_region_norm: region,
    p_last_sync_at: lastSyncIso,
    p_limit: limit,
  });
  if (error) return { ok: false, message: error.message };
  if (!Array.isArray(data)) return { ok: true, summaries: [] };
  const summaries = data
    .map(parseChangeSummaryRow)
    .filter((row): row is FeedMeetingReviewChangeSummary => row != null);
  return { ok: true, summaries };
}

export async function fetchFeedMeetingReviewsForSyncByIds(
  reviewIds: readonly string[],
): Promise<{ ok: true; reviews: FeedMeetingReviewCarouselItem[] } | { ok: false; message: string }> {
  const ids = [...new Set(reviewIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: true, reviews: [] };

  const { data, error } = await supabase.rpc('get_feed_meeting_reviews_for_sync_by_ids', {
    p_review_ids: ids,
  });
  if (error) return { ok: false, message: error.message };
  const rows = parseFeedMeetingReviewsRpcJsonbRows(data);
  const reviews = rows
    .map(parseFeedReviewRow)
    .filter((row): row is FeedMeetingReviewCarouselItem => row != null);
  return { ok: true, reviews: dedupeFeedMeetingReviewsByMeetingId(reviews) };
}
