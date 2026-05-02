import { buildFallbackPlaceSearchQueryFromCategoryLabel } from '@/src/lib/place-query-builder';

/**
 * 모임 카테고리 라벨 기반 장소 검색 시드(추천 검색어).
 * 네이버 지역 검색에 바로 넣기 좋은 짧은 한국어 구문.
 */
export function suggestPlaceSearchQueryFromCategory(categoryLabel: string): string {
  return buildFallbackPlaceSearchQueryFromCategoryLabel(categoryLabel);
}
