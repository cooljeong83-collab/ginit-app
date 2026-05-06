/**
 * 모임 생성/장소 후보 검색에서 사용하는 공용 검색 행 타입.
 * - OpenAPI(local.json)와 Android 모바일 스크래핑 결과를 동일 스키마로 맞춥니다.
 */
export type PlaceSearchRow = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** 네이버 지역 검색 `link`(플레이스·지도 등) */
  link?: string;
  /** 목록 직후에는 null — 선택 시 지오코딩/상세 스크랩으로 보강 */
  latitude: number | null;
  longitude: number | null;
  thumbnailUrl?: string | null;
};

