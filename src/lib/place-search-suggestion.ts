/**
 * 모임 카테고리 라벨 기반 장소 검색 시드(추천 검색어).
 * 네이버 지역 검색에 바로 넣기 좋은 짧은 한국어 구문.
 */
export function suggestPlaceSearchQueryFromCategory(categoryLabel: string): string {
  const L = categoryLabel.trim() || '모임';
  if (/카페|커피|디저트|브런치|티타임/.test(L)) return `홍대 카페`;
  if (/맛집|식사|레스토랑|밥|회식|식당|먹거리|고기/.test(L)) return `강남역 맛집`;
  if (/영화|극장|시네|무비|넷플|OTT/.test(L)) return `용산 CGV 주변`;
  if (/운동|헬스|러닝|런닝|등산|요가|짐|스포츠/.test(L)) return `한강 공원 러닝`;
  if (/회의|미팅|워크|업무/.test(L)) return `강남역 스터디 카페`;
  return `${L} 근처`;
}
