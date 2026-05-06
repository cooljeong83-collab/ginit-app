/**
 * 네이버 지역 검색(로컬) 행 id → Supabase `places.place_key` 네임스페이스 키.
 */
export function placeKeyFromNaverLocalSearchId(rawId: string): string {
  const t = (rawId ?? '').trim();
  if (!t) return '';
  return `naver:${t}`;
}
