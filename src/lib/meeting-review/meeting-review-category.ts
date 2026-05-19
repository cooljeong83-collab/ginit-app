import type { MeetingReviewKeywordCategory } from '@/src/lib/meeting-review/meeting-review-keywords';

/**
 * 네이버 업종 라벨(한식·카페·이자카야 등) → 리뷰 키워드 카테고리.
 * 매칭 실패 시 restaurant(음식점 키워드 + 공통).
 */
export function mapNaverCategoryToReviewCategory(raw: string | null | undefined): MeetingReviewKeywordCategory {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return 'restaurant';

  if (/카페|커피|디저트|베이커리|브런치|티룸|tea/.test(t)) {
    return 'cafe';
  }
  if (/술|바|포차|이자카야|호프|펍|와인|맥주|주점|라운지|클럽/.test(t)) {
    return 'bar';
  }
  if (/음식|식당|한식|중식|일식|양식|분식|뷔페|고기|회|치킨|피자|햄버거|맛집/.test(t)) {
    return 'restaurant';
  }

  return 'restaurant';
}
