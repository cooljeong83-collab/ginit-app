import {
  isPcGameMajorCode,
  isPlayAndVibeMajorCode,
  resolveSpecialtyKind,
  type SpecialtyKind,
} from '@/src/lib/category-specialty';
import { mapNaverCategoryToReviewCategory } from '@/src/lib/meeting-review/meeting-review-category';
import type { MeetingReviewKeywordCategory } from '@/src/lib/meeting-review/meeting-review-keywords';

export type SponsoredPlaceSearchMeetingContext = {
  categoryId?: string | null;
  majorCode?: string | null;
  specialtyKind?: SpecialtyKind | null;
  categoryLabel?: string | null;
};

export type SponsoredPlaceCategoryTarget = {
  category?: string | null;
  placeName?: string | null;
};

/** RPC `p_major_code` — DB 필터와 클라이언트 2차 필터가 같은 기준을 쓰도록 */
export function resolveMajorCodeForSponsoredPlaceSearch(
  ctx: SponsoredPlaceSearchMeetingContext,
): string | null {
  const direct = (ctx.majorCode ?? '').trim();
  if (direct) return direct;

  const sk = ctx.specialtyKind;
  if (sk === 'movie') return 'movie';
  if (sk === 'food') return 'food';
  if (sk === 'sports') return 'sports';
  if (sk === 'knowledge') return 'focus & knowledge';

  const label = (ctx.categoryLabel ?? '').trim();
  const fromLabel = label ? resolveSpecialtyKind(label) : null;
  if (fromLabel === 'movie') return 'movie';
  if (fromLabel === 'food') return 'food';
  if (fromLabel === 'sports') return 'sports';
  if (fromLabel === 'knowledge') return 'focus & knowledge';

  return null;
}

function normalizeMajorCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

/** 모임 컨텍스트에서 허용되는 네이버 업종 버킷. null이면 부스트 전부 제외(안전). */
export function allowedPlaceBucketsForMeetingContext(
  ctx: SponsoredPlaceSearchMeetingContext,
): ReadonlySet<MeetingReviewKeywordCategory> | null {
  const major = normalizeMajorCode(ctx.majorCode);

  if (major) {
    if (isPcGameMajorCode(ctx.majorCode) || isPlayAndVibeMajorCode(ctx.majorCode)) {
      return new Set(['entertainment']);
    }
    if (['eat & drink', 'cafe', 'food', 'meal', 'dining'].includes(major)) {
      return new Set(['cafe', 'restaurant', 'bar']);
    }
    if (['movie', 'cinema', 'film'].includes(major)) {
      return new Set(['movie']);
    }
    if (['active & life', 'sports', 'fitness', 'workout'].includes(major)) {
      return new Set(['sports', 'entertainment']);
    }
    if (major === 'focus & knowledge') {
      return new Set(['knowledge', 'culture', 'cafe']);
    }
    return null;
  }

  const sk = ctx.specialtyKind;
  if (sk === 'movie') return new Set(['movie']);
  if (sk === 'food') return new Set(['cafe', 'restaurant', 'bar']);
  if (sk === 'sports') return new Set(['sports', 'entertainment']);
  if (sk === 'knowledge') return new Set(['knowledge', 'culture', 'cafe']);

  const label = (ctx.categoryLabel ?? '').trim();
  const fromLabel = label ? resolveSpecialtyKind(label) : null;
  if (fromLabel === 'movie') return new Set(['movie']);
  if (fromLabel === 'food') return new Set(['cafe', 'restaurant', 'bar']);
  if (fromLabel === 'sports') return new Set(['sports', 'entertainment']);
  if (fromLabel === 'knowledge') return new Set(['knowledge', 'culture', 'cafe']);

  return null;
}

export function naverPlaceCategoryBucket(
  category: string | null | undefined,
  placeName?: string | null,
): MeetingReviewKeywordCategory {
  return mapNaverCategoryToReviewCategory(category, placeName);
}

export function sponsoredPlaceMatchesMeetingContext(
  place: SponsoredPlaceCategoryTarget,
  ctx: SponsoredPlaceSearchMeetingContext,
): boolean {
  const allowed = allowedPlaceBucketsForMeetingContext(ctx);
  if (!allowed) return false;
  const bucket = naverPlaceCategoryBucket(place.category, place.placeName);
  if (bucket === 'common') return false;
  return allowed.has(bucket);
}

export function filterSponsoredPlacesForMeetingContext<T extends SponsoredPlaceCategoryTarget>(
  places: readonly T[],
  ctx: SponsoredPlaceSearchMeetingContext,
): T[] {
  return places.filter((p) => sponsoredPlaceMatchesMeetingContext(p, ctx));
}
