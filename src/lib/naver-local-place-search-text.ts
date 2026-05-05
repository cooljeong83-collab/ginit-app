/**
 * 네이버 Open API **지역 검색(local.json)** 전용 — Google Places API 미사용.
 * 파일명만 레거시일 수 있으니, 장소 텍스트 검색은 본 모듈·`searchNaverLocalKeywordPlacesPaginated`만 사용합니다.
 */
import type { NaverLocalPlace } from '@/src/lib/naver-local-search';
import {
  resolveNaverPlaceCoordinates,
  searchNaverLocalKeywordPlacesPaginated,
} from '@/src/lib/naver-local-search';

export { stableNaverLocalSearchDedupeKey } from '@/src/lib/naver-local-search';

/**
 * 네이버 지역 검색 응답을 모임 생성 등에서 쓰는 `PlaceSearchRow` 스키마로 유지.
 * @see https://developers.naver.com/docs/serviceapi/search/local/local.md
 */
export type PlaceSearchRow = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** 네이버 지역 검색 `link`(플레이스·지도 등) */
  link?: string;
  /** 목록 직후에는 null — 선택 시 `resolvePlaceSearchRowCoordinates`로 NCP 지오코딩 */
  latitude: number | null;
  longitude: number | null;
  thumbnailUrl?: string | null;
};

export type SearchPlacesTextOptions = {
  /** 쿼리 끝에 붙는 지역 힌트(구·동 등) */
  locationBias?: string | null;
  userCoords?: { latitude: number; longitude: number } | null;
  /** 다음 페이지: `"2"`, `"3"` … (1페이지는 comment+start, 이후는 random 가상 페이지) */
  pageToken?: string | null;
  /** `pageToken`이 2 이상일 때 — 이미 목록에 있는 장소 제외(`stableNaverLocalSearchDedupeKey`) */
  excludeStablePlaceKeys?: readonly string[] | null;
  maxResultCount?: number;
  /**
   * 네이버 지역 검색은 OpenAPI에서 정렬 고정(`sort=comment`).
   * 호환용으로만 남김 — 값은 무시됩니다.
   */
  sort?: 'accuracy' | 'distance';
};

function parseNumericPageToken(pageToken: string | null | undefined): number {
  const raw = (pageToken ?? '').trim();
  if (!raw) return 1;
  if (!/^\d+$/.test(raw)) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  /** 가상 페이지 상한 — `searchNaverLocalKeywordPlacesPaginated`의 CAP과 맞춤 */
  return Math.min(200, n);
}

function naverLocalToPlaceSearchRow(p: NaverLocalPlace): PlaceSearchRow {
  return {
    id: p.id,
    title: p.title,
    address: p.address,
    roadAddress: p.roadAddress,
    category: p.category,
    ...(p.link ? { link: p.link } : {}),
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

/**
 * 네이버 지역 검색(Open API) — 키: `EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID` / `EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET`.
 */
export async function searchPlacesText(
  query: string,
  options?: SearchPlacesTextOptions,
): Promise<{ places: PlaceSearchRow[]; nextPageToken: string | null }> {
  let textQuery = query.trim();
  const bias = options?.locationBias?.trim();
  const coords = options?.userCoords;
  if (bias && !coords && textQuery && !textQuery.includes(bias)) {
    textQuery = `${textQuery} ${bias}`.replace(/\s+/g, ' ').trim();
  }
  if (!textQuery) return { places: [], nextPageToken: null };

  const page = parseNumericPageToken(options?.pageToken);
  const pageSize = Math.min(5, Math.max(1, Math.floor(options?.maxResultCount ?? 5)));

  const { places: naverPlaces, nextPageToken } = await searchNaverLocalKeywordPlacesPaginated(textQuery, {
    locationBias: options?.locationBias,
    page,
    pageSize,
    excludeStablePlaceKeys: page >= 2 ? options?.excludeStablePlaceKeys : undefined,
  });

  const places = naverPlaces.map(naverLocalToPlaceSearchRow);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[NaverLocalKeywordSearch]', {
      query: textQuery,
      page,
      pageSize,
      locationBias: bias ?? null,
      userCoords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
      count: places.length,
      nextPageToken,
    });
  }

  return { places, nextPageToken };
}

/** 목록에 좌표가 없으면 NCP 지오코딩으로 보강(네이버 지역 검색 응답). */
export async function resolvePlaceSearchRowCoordinates(row: PlaceSearchRow): Promise<PlaceSearchRow> {
  if (row.latitude != null && row.longitude != null) return row;
  const resolved = await resolveNaverPlaceCoordinates({
    id: row.id,
    title: row.title,
    address: row.address,
    roadAddress: row.roadAddress,
    category: row.category,
    link: row.link,
    latitude: row.latitude,
    longitude: row.longitude,
  });
  return {
    ...row,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    roadAddress: resolved.roadAddress || row.roadAddress,
    address: resolved.address || row.address,
  };
}
