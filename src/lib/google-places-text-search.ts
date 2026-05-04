import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
import { normalizeCorsProxyBase } from '@/src/lib/naver-ncp-maps';

/**
 * Kakao 로컬 API 키워드로 장소 검색 — 기존 Google Text Search 호환 필드(`PlaceSearchRow`).
 * @see https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword
 */
export type PlaceSearchRow = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** 카카오맵 장소 상세 URL */
  link?: string;
  latitude: number | null;
  longitude: number | null;
  /** Kakao 키워드 응답에는 사진 URL이 없음 — 네이버 이미지 등 보조 경로만 사용 */
  thumbnailUrl?: string | null;
};

export type SearchPlacesTextOptions = {
  /** 네이버 시절과 동일: 좌표 없을 때 쿼리 끝에 붙는 지역 힌트 문자열 */
  locationBias?: string | null;
  userCoords?: { latitude: number; longitude: number } | null;
  /** Kakao: 다음 페이지 번호 문자열(`"2"`, `"3"` …). Google 시절 불투명 토큰은 무시하고 1페이지로 처리 */
  pageToken?: string | null;
  maxResultCount?: number;
  /**
   * Kakao 키워드 검색 정렬. API는 `accuracy` | `distance`만 지원(별점·리뷰 수 정렬 없음).
   * - `accuracy`(기본): 키워드·지역 연관도 순 — “인기/노출”에 가깝게 쓰이는 쪽.
   * - `distance`: `x`,`y` 기준 가까운 순.
   */
  sort?: 'accuracy' | 'distance';
};

const KAKAO_KEYWORD_BASE = 'https://dapi.kakao.com/v2/local/search/keyword.json';

function resolveKakaoRestApiKey(): string {
  return (publicEnv.kakaoRestApiKey ?? '').trim();
}

function wrapKakaoDapiHttpsForWebFetch(absoluteHttpsUrl: string): string {
  if (Platform.OS !== 'web') return absoluteHttpsUrl;
  const proxyRaw = publicEnv.naverLocalSearchCorsProxy?.trim();
  if (!proxyRaw) return absoluteHttpsUrl;
  return `${normalizeCorsProxyBase(proxyRaw)}/${absoluteHttpsUrl}`;
}

type KakaoKeywordMeta = {
  is_end?: boolean;
  pageable_count?: number;
  total_count?: number;
  /** 키워드·지역 분석(문서 참고) */
  same_name?: unknown;
};

type KakaoKeywordDoc = {
  id?: string;
  place_name?: string;
  category_name?: string;
  category_group_code?: string;
  category_group_name?: string;
  phone?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string;
  y?: string;
  place_url?: string;
  /** x,y,radius 요청 시에만 */
  distance?: string;
};

type KakaoKeywordResponse = {
  meta?: KakaoKeywordMeta;
  documents?: KakaoKeywordDoc[];
};

function parseKakaoPage(pageToken: string | null | undefined): number {
  const raw = (pageToken ?? '').trim();
  if (!raw) return 1;
  if (!/^\d+$/.test(raw)) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(45, n);
}

function parseKakaoDoc(d: KakaoKeywordDoc, index: number): PlaceSearchRow | null {
  const title = typeof d.place_name === 'string' ? d.place_name.trim() : '';
  const jibun = typeof d.address_name === 'string' ? d.address_name.trim() : '';
  const road = typeof d.road_address_name === 'string' ? d.road_address_name.trim() : '';
  const formatted = road || jibun;
  if (!title && !formatted) return null;

  const lngStr = typeof d.x === 'string' ? d.x.trim() : '';
  const latStr = typeof d.y === 'string' ? d.y.trim() : '';
  const lng = lngStr ? Number.parseFloat(lngStr) : NaN;
  const lat = latStr ? Number.parseFloat(latStr) : NaN;
  const longitude = Number.isFinite(lng) ? lng : null;
  const latitude = Number.isFinite(lat) ? lat : null;

  const cat =
    typeof d.category_name === 'string' && d.category_name.trim()
      ? d.category_name.trim()
      : typeof d.category_group_name === 'string'
        ? d.category_group_name.trim()
        : '';

  const pid = typeof d.id === 'string' && d.id.trim() ? d.id.trim() : '';
  const id = pid ? `kakao-place-${pid}` : `kakao-place-idx-${index}-${title.slice(0, 12)}`;

  const link =
    typeof d.place_url === 'string' && d.place_url.trim().startsWith('http') ? d.place_url.trim() : undefined;

  return {
    id,
    title: title || formatted,
    address: jibun || road,
    roadAddress: road || jibun,
    category: cat,
    ...(link ? { link } : {}),
    latitude,
    longitude,
  };
}

/**
 * Kakao 로컬 API — 키워드로 장소 검색(Text Search 대체).
 * @see https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword
 */
export async function searchPlacesText(
  query: string,
  options?: SearchPlacesTextOptions,
): Promise<{ places: PlaceSearchRow[]; nextPageToken: string | null }> {
  const apiKey = resolveKakaoRestApiKey();
  if (!apiKey) {
    throw new Error(
      'Kakao REST API 키가 없습니다. env에 EXPO_PUBLIC_KAKAO_REST_API_KEY를 설정하고 Metro를 재시작하세요. (카카오디벨로퍼스 > 내 애플리케이션 > 앱 키 > REST API 키)',
    );
  }

  let textQuery = query.trim();
  const bias = options?.locationBias?.trim();
  const coords = options?.userCoords;
  if (bias && !coords && textQuery && !textQuery.includes(bias)) {
    textQuery = `${textQuery} ${bias}`.replace(/\s+/g, ' ').trim();
  }
  if (!textQuery) return { places: [], nextPageToken: null };

  const page = parseKakaoPage(options?.pageToken);
  const size = Math.min(15, Math.max(1, Math.floor(options?.maxResultCount ?? 10)));

  const params = new URLSearchParams();
  params.set('query', textQuery);
  params.set('page', String(page));
  params.set('size', String(size));

  if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) {
    params.set('x', String(coords.longitude));
    params.set('y', String(coords.latitude));
    params.set('radius', '20000');
    const sort = options?.sort === 'distance' ? 'distance' : 'accuracy';
    params.set('sort', sort);
  }

  const qs = params.toString();
  const bareUrl = `${KAKAO_KEYWORD_BASE}?${qs}`;
  const url = wrapKakaoDapiHttpsForWebFetch(bareUrl);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `KakaoAK ${apiKey}`,
    },
  });

  if (!res.ok) {
    const t = await res.text();
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[KakaoLocalKeywordSearch] HTTP error', {
        status: res.status,
        query: textQuery,
        page,
        size,
        bodyPreview: t.slice(0, 500),
      });
    }
    throw new Error(`Kakao 장소 검색 오류 (${res.status}): ${t.slice(0, 200)}`);
  }

  const json = (await res.json()) as KakaoKeywordResponse;
  const raw = json.documents ?? [];
  const places: PlaceSearchRow[] = [];
  raw.forEach((d, idx) => {
    const row = parseKakaoDoc(d, idx);
    if (row) places.push(row);
  });

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[KakaoLocalKeywordSearch] request', {
      query: textQuery,
      page,
      size,
      locationBias: bias ?? null,
      userCoords: coords
        ? { latitude: coords.latitude, longitude: coords.longitude }
        : null,
      sort: coords ? (options?.sort === 'distance' ? 'distance' : 'accuracy') : 'accuracy(default)',
    });
    // eslint-disable-next-line no-console
    console.log('[KakaoLocalKeywordSearch] response.meta', JSON.stringify(json.meta ?? {}, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[KakaoLocalKeywordSearch] response.documents (${raw.length}건)`, JSON.stringify(raw, null, 2));
    // eslint-disable-next-line no-console
    console.log('[KakaoLocalKeywordSearch] mapped PlaceSearchRow[]', JSON.stringify(places, null, 2));
  }

  const isEnd = json.meta?.is_end === true;
  const nextPageToken = !isEnd && page < 45 ? String(page + 1) : null;

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[KakaoLocalKeywordSearch] pagination', { isEnd, nextPageToken, page });
  }

  return { places, nextPageToken };
}

/** 좌표가 이미 있으면 그대로 반환(Kakao 키워드 응답은 항상 x,y 포함). */
export async function resolvePlaceSearchRowCoordinates(row: PlaceSearchRow): Promise<PlaceSearchRow> {
  if (row.latitude != null && row.longitude != null) return row;
  throw new Error('장소 좌표를 불러오지 못했습니다. 다시 검색해 주세요.');
}
