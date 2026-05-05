import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
import { isKakaoMapPlacePageUrl } from '@/src/lib/kakao-place-page-image';
import {
  geocodeNaverMapsAddress,
  withCorsProxyForWeb,
  type NaverMapsGeocodeAddress,
  type NaverMapsGeocodeResponse,
} from '@/src/lib/naver-ncp-maps';
import { withNaverOpenApiClientRateLimit } from '@/src/lib/naver-openapi-rate-limit';

export type NaverLocalPlace = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** 네이버 지역 검색 API `link` — 플레이스 등 상세 URL (없을 수 있음) */
  link?: string;
  /** 지역 검색 직후에는 null — 항목 선택 시 NCP Geocoding으로 채움 */
  latitude: number | null;
  longitude: number | null;
};

/** API `link` 값을 앱 내 WebView 로드용 https URL로 정규화합니다. */
export function sanitizeNaverLocalPlaceLink(raw: string | null | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  try {
    const normalized = t.startsWith('http://') || t.startsWith('https://') ? t : `https://${t}`;
    const u = new URL(normalized);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    if (!u.hostname) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * `link`가 카카오맵 **장소 상세**(`place.map.kakao.com`)일 때만 https URL을 반환합니다.
 * (모임 생성 장소 후보의 노란색「카카오」버튼 전용)
 */
export function resolveKakaoPlacePageWebUrl(link?: string | null | undefined): string | undefined {
  const direct = sanitizeNaverLocalPlaceLink((link ?? '').trim());
  if (!direct || !isKakaoMapPlacePageUrl(direct)) return undefined;
  return direct;
}

/** `map.naver.com` / `m.map.naver.com` 경로에서 플레이스 숫자 ID 추출 */
function extractPlaceIdFromNaverMapPath(pathname: string): string | undefined {
  const entry = pathname.match(/\/entry\/place\/(\d{4,})\b/);
  if (entry?.[1]) return entry[1];
  // 예: /p/search/.../place/11583151?placePath=… (entry 없이 지도 검색 URL만 오는 경우)
  const placeTail = pathname.match(/\/place\/(\d{4,})(?:\/|$|\?)/);
  if (placeTail?.[1]) return placeTail[1];
  return undefined;
}

/**
 * URL 전체에서 네이버 **플레이스 숫자 ID**를 찾습니다(지도·플레이스 경로·쿼리 `pinId` 등).
 * 통합검색으로 보낼 때 검색어 보강용으로만 씁니다.
 */
function extractNaverPlaceNumericIdFromUrl(urlString: string): string | undefined {
  const raw = urlString?.trim() ?? '';
  if (!raw) return undefined;
  try {
    const normalized = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const u = new URL(normalized);
    const fromPath = extractPlaceIdFromNaverMapPath(u.pathname);
    if (fromPath) return fromPath;
    for (const key of ['pinId', 'businessId', 'placeId', 'code']) {
      const v = u.searchParams.get(key)?.trim() ?? '';
      if (/^\d{4,}$/.test(v)) return v;
    }
  } catch {
    const m =
      raw.match(/\/entry\/place\/(\d{4,})\b/) ??
      raw.match(/\/place\/(\d{4,})(?:\/|[\?#]|$)/);
    if (m?.[1] && m[1] !== 'list') return m[1];
  }
  return undefined;
}

/**
 * WebView에 넣기 전 URL 정리: 이미 **모바일 통합검색**이면 그대로 두고,
 * 네이버 지도·플레이스 링크는 플레이스 페이지 대신 **동일 검색어(숫자 ID)** 로 통합검색으로 보냅니다.
 */
export function normalizeNaverPlaceDetailWebUrl(url: string): string {
  const raw = url?.trim() ?? '';
  if (!raw) return raw;
  try {
    const normalized = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const u = new URL(normalized);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;

    const host = u.hostname.toLowerCase();
    if (host === 'm.search.naver.com' || host === 'search.naver.com') {
      return u.toString();
    }

    const isMapHost = host === 'map.naver.com' || host === 'm.map.naver.com';
    const isPlaceHost =
      host === 'm.place.naver.com' || host === 'place.naver.com' || host.endsWith('.place.naver.com');

    if (isMapHost || isPlaceHost) {
      const id = extractNaverPlaceNumericIdFromUrl(u.toString());
      if (id) {
        return `https://m.search.naver.com/search.naver?where=m&sm=mtp_hty.top&query=${encodeURIComponent(id)}`;
      }
    }

    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * 주소 한 줄에서 **행정구의 '…구'까지**만 남깁니다(로·길·번지 앞에서 끊음).
 * 예: `서울특별시 강남구 테헤란로 152` → `서울특별시 강남구` / 구가 없으면 도로명·지번 앞 단계까지만.
 */
function truncateAddressForNaverSearchQuery(address: string): string {
  const normalized = address.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const parts = normalized.split(' ');
  const acc: string[] = [];
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const isRoadOrLotToken =
      /^\d/.test(p) || /(?:로|길)$/u.test(p) || p.includes('번길') || /^[0-9]+-[0-9]+$/.test(p);
    if (isRoadOrLotToken) break;
    acc.push(p);
    if (/[가-힣]+구$/u.test(p) && p.length >= 2) break;
  }
  const out = acc.join(' ').trim();
  return out || normalized;
}

/** 한 줄 주소(행정 **구**까지 잘린 뒤) + 상호(+ 폴백 시 카테고리)로 네이버 **모바일 통합검색**(m.search) 검색어를 만듭니다. `link`는 사용하지 않습니다. */
function buildNaverMobileSearchUrlFromPlaceFields(input: {
  title: string;
  roadAddress?: string | null | undefined;
  address?: string | null | undefined;
  category?: string | null | undefined;
}): string | undefined {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const road = typeof input.roadAddress === 'string' ? input.roadAddress.trim() : '';
  const jibun = typeof input.address === 'string' ? input.address.trim() : '';
  const cat = typeof input.category === 'string' ? input.category.trim() : '';
  const addrLine = road || jibun;
  const addrForQuery = addrLine ? truncateAddressForNaverSearchQuery(addrLine) : '';
  const primary = [addrForQuery, title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const q =
    primary.length > 0
      ? primary
      : [title, cat].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || cat;
  const finalQ = (q || title).trim();
  if (!finalQ) return undefined;
  return sanitizeNaverLocalPlaceLink(
    `https://m.search.naver.com/search.naver?where=m&sm=mtp_hty.top&query=${encodeURIComponent(finalQ)}`,
  );
}

/**
 * 상세(WebView) URL: 네이버 플레이스가 아니라 **모바일 네이버 통합검색**(`m.search.naver.com`)으로
 * 주소(행정 **구** 단위까지 잘린 한 줄) + 상호(또는 카테고리 폴백) 검색 결과를 띄웁니다. API `link`는 검색어에 쓰지 않습니다.
 */
export function resolveNaverPlaceDetailWebUrl(input: {
  link?: string | null | undefined;
  title: string;
  roadAddress?: string | null | undefined;
  address?: string | null | undefined;
  category?: string | null | undefined;
}): string | undefined {
  return buildNaverMobileSearchUrlFromPlaceFields({
    title: input.title,
    roadAddress: input.roadAddress,
    address: input.address,
    category: input.category,
  });
}

/**
 * 모임 상세 **장소 투표 칩**(`naverPlaceLink`는 무시·한 줄 `address` + 상호 순)과 동일한 인자로
 * 네이버 모바일 **통합검색** URL을 만듭니다.
 */
export function resolveNaverPlaceDetailWebUrlLikeVoteChip(input: {
  naverPlaceLink?: string | null | undefined;
  title: string;
  /** 한 줄 주소(모임 `placeCandidates.address` / 칩 `sub`) */
  addressLine?: string | null | undefined;
}): string | undefined {
  const line = typeof input.addressLine === 'string' ? input.addressLine.trim() : '';
  return resolveNaverPlaceDetailWebUrl({
    link: input.naverPlaceLink,
    title: input.title,
    roadAddress: line || undefined,
    address: undefined,
    category: undefined,
  });
}

/**
 * 장소 상세(WebView): API `link` 또는 저장된 `naverPlaceLink`(카카오 `place_url` 등)가 있으면 그 URL을 쓰고,
 * 없으면 제목·한 줄 주소로 네이버 모바일 통합검색(`resolveNaverPlaceDetailWebUrlLikeVoteChip`)으로 폴백합니다.
 */
export function resolvePlaceDetailWebUrlPreferLink(input: {
  link?: string | null | undefined;
  naverPlaceLink?: string | null | undefined;
  title: string;
  addressLine?: string | null | undefined;
}): string | undefined {
  const raw = (input.link ?? input.naverPlaceLink ?? '').trim();
  const direct = sanitizeNaverLocalPlaceLink(raw);
  if (direct) return direct;
  return resolveNaverPlaceDetailWebUrlLikeVoteChip({
    naverPlaceLink: undefined,
    title: input.title,
    addressLine: input.addressLine,
  });
}

/**
 * 영화 제목으로 네이버 모바일 **통합검색** URL을 만듭니다.
 * 검색어 형식: `영화 {제목}` (예: `영화 슈퍼 마리오 갤럭시`)
 */
export function resolveNaverMovieSearchWebUrl(movieTitle: string): string | undefined {
  const title = typeof movieTitle === 'string' ? movieTitle.trim() : '';
  if (!title) return undefined;
  const q = `영화 ${title}`.replace(/\s+/g, ' ').trim();
  return sanitizeNaverLocalPlaceLink(
    `https://m.search.naver.com/search.naver?where=m&sm=mtp_hty.top&query=${encodeURIComponent(q)}`,
  );
}

/**
 * 상호·주소로 네이버 모바일 **통합검색**(WebView)을 엽니다.
 */
export function buildNaverPlaceFallbackWebUrl(placeName: string, address?: string | null): string | undefined {
  return resolveNaverPlaceDetailWebUrl({
    link: undefined,
    title: placeName,
    roadAddress: address ?? undefined,
    address: undefined,
    category: undefined,
  });
}

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

type GeocodeAddrEl = NonNullable<NaverMapsGeocodeAddress['addressElements']>[number];

function addressElementKinds(el: GeocodeAddrEl): string[] {
  const e = el as { types?: string[]; type?: string | string[] };
  if (Array.isArray(e.types) && e.types.length > 0) return e.types;
  if (Array.isArray(e.type)) return e.type;
  if (typeof e.type === 'string' && e.type) return [e.type];
  return [];
}

function coordToNumber(v: string | number | undefined | null): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function titleFromGeocode(addr: NaverMapsGeocodeAddress, fallbackQuery: string): string {
  const road = typeof addr.roadAddress === 'string' ? addr.roadAddress.trim() : '';
  const jibun = typeof addr.jibunAddress === 'string' ? addr.jibunAddress.trim() : '';
  const elements = addr.addressElements ?? [];
  const building = elements.find((el) => addressElementKinds(el).includes('BUILDING_NAME'));
  const buildingName = typeof building?.longName === 'string' ? building.longName.trim() : '';
  if (buildingName) return buildingName;
  if (road) return road;
  if (jibun) return jibun;
  return fallbackQuery.trim();
}

function parseGeocodeToPlaces(addresses: NaverMapsGeocodeAddress[], query: string): NaverLocalPlace[] {
  const out: NaverLocalPlace[] = [];
  addresses.forEach((addr, idx) => {
    const lon = coordToNumber(addr.x);
    const lat = coordToNumber(addr.y);
    if (lon == null || lat == null) return;

    const xKey = typeof addr.x === 'number' ? String(addr.x) : (addr.x ?? '').toString().trim();
    const yKey = typeof addr.y === 'number' ? String(addr.y) : (addr.y ?? '').toString().trim();

    const roadAddress = typeof addr.roadAddress === 'string' ? addr.roadAddress : '';
    const jibunAddress = typeof addr.jibunAddress === 'string' ? addr.jibunAddress : '';

    out.push({
      id: `${xKey}-${yKey}-${idx}`,
      title: titleFromGeocode(addr, query),
      address: jibunAddress,
      roadAddress,
      category: '',
      latitude: lat,
      longitude: lon,
    });
  });
  return out;
}

function assertGeocodeOk(json: NaverMapsGeocodeResponse) {
  if (json.status != null && json.status !== '' && json.status !== 'OK') {
    const msg = json.errorMessage?.trim() || json.status;
    throw new Error(`네이버 지오코딩 오류: ${msg}`);
  }
}

type NaverOpenApiLocalJson = {
  total?: string | number;
  start?: string | number;
  display?: string | number;
  items?: {
    title?: string;
    link?: string;
    category?: string;
    description?: string;
    telephone?: string;
    address?: string;
    roadAddress?: string;
    mapx?: string;
    mapy?: string;
  }[];
};

/**
 * OpenAPI 지역 검색 응답 상세 덤프.
 * - `env/.env`에 `EXPO_PUBLIC_NAVER_LOCAL_SEARCH_DEBUG=1` (또는 true/yes/on/y) 후 **네이티브 재빌드** 권장 (`pickExtra`가 extra에 넣음).
 * - Metro/Logcat에서 `console.warn`(노란색)으로 출력 — `console.log`만 켜져 있으면 안 보일 때가 있음.
 */
function isNaverLocalSearchApiDebug(): boolean {
  const v = publicEnv.naverLocalSearchDebug?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'y';
}

function summarizeNaverOpenApiLocalItemsForDev(items: NaverOpenApiLocalJson['items']): Record<string, unknown>[] {
  const list = items ?? [];
  return list.map((it, i) => {
    const title = stripHtml(typeof it.title === 'string' ? it.title : '').slice(0, 200);
    const description = (typeof it.description === 'string' ? it.description : '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const link = typeof it.link === 'string' ? it.link : '';
    return {
      i,
      title,
      telephone: (typeof it.telephone === 'string' ? it.telephone : '').slice(0, 40),
      category: (typeof it.category === 'string' ? it.category : '').slice(0, 100),
      description,
      address: (typeof it.address === 'string' ? it.address : '').slice(0, 150),
      roadAddress: (typeof it.roadAddress === 'string' ? it.roadAddress : '').slice(0, 150),
      mapx: typeof it.mapx === 'string' ? it.mapx : '',
      mapy: typeof it.mapy === 'string' ? it.mapy : '',
      linkPreview: link.slice(0, 160),
    };
  });
}

/** 개발 빌드에서 스키마 + **조회된 각 행 요약**(제목·주소·좌표 문자열 등)을 남김 */
function logNaverOpenApiLocalJsonShapeDev(query: string, json: NaverOpenApiLocalJson): void {
  if (!__DEV__) return;
  const items = json.items ?? [];
  const item0 = items[0];
  const topLevelKeys = json && typeof json === 'object' ? Object.keys(json as Record<string, unknown>) : [];
  const firstItemKeys =
    item0 && typeof item0 === 'object' ? Object.keys(item0 as Record<string, unknown>) : [];
  const payload = {
    query: query.slice(0, 120),
    topLevelKeys,
    firstItemKeys,
    total: json.total,
    start: json.start,
    display: json.display,
    itemCount: items.length,
    items: summarizeNaverOpenApiLocalItemsForDev(items),
  };
  // eslint-disable-next-line no-console
  console.warn('[naver-local-search][dev] openapi/local.json shape + rows\n', JSON.stringify(payload, null, 2));
}

function logNaverOpenApiLocalResponse(
  label: string,
  query: string,
  req: { display: number; start: number; sort?: string },
  json: NaverOpenApiLocalJson,
): void {
  if (!isNaverLocalSearchApiDebug()) return;
  const items = json.items ?? [];
  const itemsPreview = summarizeNaverOpenApiLocalItemsForDev(items).slice(0, 10);
  // eslint-disable-next-line no-console
  console.warn(
    '[naver-local-search] openapi_local_response',
    label,
    JSON.stringify({
      query: query.slice(0, 200),
      req,
      total: json.total,
      start: json.start,
      display: json.display,
      itemCount: items.length,
      itemsPreview,
      rawJsonHead: JSON.stringify(json).slice(0, 8000),
    }),
  );
}

/**
 * `local-{mapx}-{mapy}-{idx}` 또는 그 외 id — random 보충 시 제외 집합에 사용.
 * @see https://developers.naver.com/docs/serviceapi/search/local/local.md
 */
export function stableNaverLocalSearchDedupeKey(row: { id: string }): string {
  const m = row.id.match(/^local-(\d+)-(\d+)-\d+$/);
  if (m) return `${m[1]}|${m[2]}`;
  return row.id;
}

/** 지역 검색 JSON → 목록용 플레이스 (좌표는 선택 후 Geocoding으로만 채움). */
function parseOpenApiLocalItems(json: NaverOpenApiLocalJson): NaverLocalPlace[] {
  const items = json.items ?? [];
  const out: NaverLocalPlace[] = [];
  items.forEach((it, idx) => {
    const title = stripHtml(typeof it.title === 'string' ? it.title : '');
    const address = typeof it.address === 'string' ? it.address : '';
    const roadAddress = typeof it.roadAddress === 'string' ? it.roadAddress : '';
    const category = typeof it.category === 'string' ? it.category : '';
    const mapx = typeof it.mapx === 'string' ? it.mapx : '';
    const mapy = typeof it.mapy === 'string' ? it.mapy : '';
    const linkRaw = typeof it.link === 'string' ? it.link : '';
    const link = sanitizeNaverLocalPlaceLink(linkRaw);
    out.push({
      id: `local-${mapx}-${mapy}-${idx}`,
      title,
      address,
      roadAddress,
      category,
      ...(link ? { link } : {}),
      latitude: null,
      longitude: null,
    });
  });
  return out;
}

/**
 * openapi 지역 검색 — **X-Naver-Client-Id / X-Naver-Client-Secret 만** (Search API 전용 키).
 * 응답 덤프: `EXPO_PUBLIC_NAVER_LOCAL_SEARCH_DEBUG=1` (Metro에서 `[naver-local-search] openapi_local_response` 검색).
 */
async function fetchOpenApiLocalSearch(
  query: string,
  opts?: { display?: number; start?: number; sort?: 'comment' | 'random' },
): Promise<NaverOpenApiLocalJson> {
  const id = publicEnv.naverSearchClientId?.trim();
  const secret = publicEnv.naverSearchClientSecret?.trim();
  if (!id || !secret) {
    throw new Error(
      '지역 검색(상호)용 키가 없습니다. env에 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID와 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET을 설정하세요.',
    );
  }

  const q = query.trim();
  /** 네이버 지역 검색 API 문서상 display 최댓값 5 */
  const display = Math.min(5, Math.max(1, Math.floor(opts?.display ?? 5)));
  const start = Math.max(1, Math.floor(opts?.start ?? 1));
  const sort = opts?.sort === 'random' ? 'random' : 'comment';
  const baseUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=${display}&start=${start}&sort=${sort}`;

  return withNaverOpenApiClientRateLimit(async () => {
    let url = baseUrl;
    if (Platform.OS === 'web') {
      url = withCorsProxyForWeb(baseUrl);
    }

    const headers: Record<string, string> = {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
      Accept: 'application/json',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`지역 검색 API 오류 (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as NaverOpenApiLocalJson;
    logNaverOpenApiLocalJsonShapeDev(q, json);
    logNaverOpenApiLocalResponse('fetchOpenApiLocalSearch', q, { display, start, sort }, json);
    return json;
  });
}

/**
 * 유저가 고른 항목의 주소로 NCP Geocoding → 위·경도 (Maps용 `naverLocal*` + X-NCP-* 는 `geocodeNaverMapsAddress` 내부).
 */
export async function resolveNaverPlaceCoordinates(place: NaverLocalPlace): Promise<NaverLocalPlace> {
  const q = (place.roadAddress?.trim() || place.address?.trim() || place.title?.trim() || '').trim();
  if (!q) {
    throw new Error('주소 정보가 없어 위치를 표시할 수 없습니다.');
  }

  const json = await geocodeNaverMapsAddress(q, 1);
  assertGeocodeOk(json);
  const rows = parseGeocodeToPlaces(json.addresses ?? [], q);
  const first = rows[0];
  if (!first || first.latitude == null || first.longitude == null) {
    throw new Error('주소로 좌표를 찾지 못했습니다.');
  }

  return {
    ...place,
    latitude: first.latitude,
    longitude: first.longitude,
    roadAddress: first.roadAddress || place.roadAddress,
    address: first.address || place.address,
  };
}

export type SearchNaverLocalPlacesOptions = {
  /**
   * 역지오로 얻은 구·동 등. 있으면 지역 검색·지오코딩 폴백 쿼리 끝에 붙여 **내 주변** 결과를 유도합니다.
   * (네이버 Local API는 좌표 파라미터가 없어 쿼리 보강으로 처리)
   */
  locationBias?: string | null;
  /** openapi local search pagination (1-based) */
  start?: number;
  /** openapi local search page size (default 5) */
  display?: number;
};

function applyLocationBiasToQuery(trimmed: string, bias: string | null | undefined): string {
  const b = bias?.trim();
  if (!b) return trimmed;
  if (trimmed.includes(b)) return trimmed;
  return `${trimmed} ${b}`;
}

/**
 * OpenAPI `sort=random`이 동일 풀만 돌 때 — ZWNJ(U+200C)를 소량 붙여 검색 토큰만 미세하게 바꿉니다(표시상 거의 동일).
 * `page`가 클수록 조금 더 길게(상한 있음).
 */
function diversifyLocalSearchQueryForVirtualPage(q: string, page: number): string {
  const t = q.trim();
  if (!t || page < 3) return t;
  const repeats = Math.min(6, Math.max(1, page - 2));
  return `${t}${'\u200C'.repeat(repeats)}`;
}

/**
 * 1) Search API 지역 검색 (openapi, X-Naver-*).
 * 2) 결과가 없으면 NCP Geocoding으로 쿼리 자체를 주소처럼 조회.
 */
export async function searchNaverLocalPlaces(
  query: string,
  options?: SearchNaverLocalPlacesOptions,
): Promise<NaverLocalPlace[]> {
  const q0 = query.trim();
  if (!q0) return [];

  const q = applyLocationBiasToQuery(q0, options?.locationBias);

  const hasSearchKeys = Boolean(
    publicEnv.naverSearchClientId?.trim() && publicEnv.naverSearchClientSecret?.trim(),
  );

  if (hasSearchKeys) {
    try {
      const json = await fetchOpenApiLocalSearch(q, { display: options?.display, start: options?.start });
      const list = parseOpenApiLocalItems(json);
      if (list.length > 0) return list;
    } catch (e) {
      const skipOpenApiOnWeb =
        Platform.OS === 'web' &&
        e instanceof Error &&
        (e.message === 'CORS_PROXY_REQUIRED' || e.message.includes('CORS'));
      if (!skipOpenApiOnWeb) {
        throw e;
      }
    }
  }

  const json = await geocodeNaverMapsAddress(q, 10);
  assertGeocodeOk(json);
  return parseGeocodeToPlaces(json.addresses ?? [], q);
}

export type SearchNaverLocalKeywordPagedOptions = {
  locationBias?: string | null;
  /** 1부터. `pageToken` 문자열 페이지와 동일하게 쓰려면 1,2,3… */
  page?: number;
  /** 네이버 지역 검색 API 상한 5 */
  pageSize?: number;
  /**
   * `page>=2` random 보충 시 이미 목록에 있는 장소 제외(`stableNaverLocalSearchDedupeKey`와 동일 규칙 문자열).
   * 누적 행 id에서 키를 만들어 넘기면 이후 페이지가 계속 붙습니다.
   */
  excludeStablePlaceKeys?: readonly string[] | null;
};

/**
 * OpenAPI 지역 검색만 사용(지오코딩 폴백 없음). 모임 생성·장소 후보 리스트 페이지네이션용.
 *
 * 1페이지: `sort=comment`, `start` 오프셋(공식적으로는 start>1이 무시되는 공지가 있어 1페이지만 의미 있음).
 * 2페이지 이후: OpenAPI가 `start>1`을 1로 돌려 **동일 5건**만 주는 경우가 있어, `start=1` + `sort=random`으로
 * 다른 후보를 받고(중복은 호출 측에서 제거), 가상 페이지 상한까지 `nextPageToken`을 이어 줍니다.
 *
 * @see https://developers.naver.com/docs/serviceapi/search/local/local.md
 * @see https://developers.naver.com/notice/article/7528
 */
async function collectRandomUniqueLocalPlaces(
  q: string,
  pageSize: number,
  exclude: ReadonlySet<string>,
): Promise<NaverLocalPlace[]> {
  const out: NaverLocalPlace[] = [];
  let stagnantRounds = 0;
  /** 제외 집합이 커질수록 같은 random 5건 반복에 걸리기 쉬워 라운드·정체 허용을 넉넉히 둠 */
  const MAX_ROUNDS = Math.min(36, 14 + Math.min(22, Math.floor(exclude.size / 2)));
  const STAGNANT_STOP = exclude.size >= 12 ? 7 : 5;

  for (let round = 0; round < MAX_ROUNDS && out.length < pageSize; round++) {
    const json = await fetchOpenApiLocalSearch(q, { display: pageSize, start: 1, sort: 'random' });
    const respStartRaw = json.start;
    const respStart =
      typeof respStartRaw === 'string'
        ? Number.parseInt(String(respStartRaw), 10) || 1
        : Number(respStartRaw ?? 1) || 1;
    if (respStart !== 1) break;

    const batch = parseOpenApiLocalItems(json);
    let addedThisRound = 0;
    for (const p of batch) {
      const k = stableNaverLocalSearchDedupeKey(p);
      if (exclude.has(k)) continue;
      if (out.some((x) => stableNaverLocalSearchDedupeKey(x) === k)) continue;
      out.push(p);
      addedThisRound++;
      if (out.length >= pageSize) break;
    }
    if (addedThisRound === 0) stagnantRounds++;
    else stagnantRounds = 0;
    if (stagnantRounds >= STAGNANT_STOP) break;
    if (batch.length === 0) break;
  }

  if (out.length === 0 && exclude.size >= pageSize) {
    for (let br = 0; br < 18 && out.length < pageSize; br++) {
      const json = await fetchOpenApiLocalSearch(q, { display: pageSize, start: 1, sort: 'random' });
      const batch = parseOpenApiLocalItems(json);
      if (batch.length === 0) break;
      for (const p of batch) {
        const k = stableNaverLocalSearchDedupeKey(p);
        if (exclude.has(k)) continue;
        if (out.some((x) => stableNaverLocalSearchDedupeKey(x) === k)) continue;
        out.push(p);
        if (out.length >= pageSize) break;
      }
    }
  }

  return out;
}

export async function searchNaverLocalKeywordPlacesPaginated(
  query: string,
  options?: SearchNaverLocalKeywordPagedOptions,
): Promise<{ places: NaverLocalPlace[]; nextPageToken: string | null }> {
  const q0 = query.trim();
  if (!q0) return { places: [], nextPageToken: null };

  const page = Math.max(1, Math.floor(options?.page ?? 1));
  const pageSize = Math.min(5, Math.max(1, Math.floor(options?.pageSize ?? 5)));
  /** random 가상 페이지 — 과호출 방지(5건×40=200행 상한 근처) */
  const NAVER_LOCAL_VIRTUAL_PAGE_CAP = 60;

  const q = applyLocationBiasToQuery(q0, options?.locationBias);

  if (page === 1) {
    const requestedStart = 1;
    const json = await fetchOpenApiLocalSearch(q, { display: pageSize, start: requestedStart, sort: 'comment' });
    const places = parseOpenApiLocalItems(json);

    const totalRaw = json.total;
    const totalNum =
      typeof totalRaw === 'string' ? Number.parseInt(String(totalRaw), 10) || 0 : Number(totalRaw ?? 0) || 0;
    const respStartRaw = json.start;
    const respStart =
      typeof respStartRaw === 'string'
        ? Number.parseInt(String(respStartRaw), 10) || requestedStart
        : Number(respStartRaw ?? requestedStart) || requestedStart;

    const fullPage = places.length === pageSize;
    const nextStart = requestedStart + places.length;
    /** 검색 API 오류코드 SE03 기준 허용 범위(문서) */
    const NAVER_LOCAL_SEARCH_MAX_START = 1000;

    const exhaustedByShortPage = places.length > 0 && places.length < pageSize;
    const startHonored = respStart === requestedStart;
    const moreByReportedTotal = totalNum > 0 && nextStart <= totalNum;
    const totalLooksCapped = totalNum > 0 && fullPage && nextStart > totalNum;
    const moreDespiteCappedTotalReport =
      totalLooksCapped && nextStart <= NAVER_LOCAL_SEARCH_MAX_START && startHonored;
    const moreWhenTotalMissing =
      totalNum === 0 && fullPage && nextStart <= NAVER_LOCAL_SEARCH_MAX_START && startHonored;

    const hasMore =
      !exhaustedByShortPage &&
      places.length > 0 &&
      startHonored &&
      (moreByReportedTotal || moreDespiteCappedTotalReport || moreWhenTotalMissing);

    return {
      places,
      nextPageToken: hasMore ? String(page + 1) : null,
    };
  }

  const exclude = new Set(
    (options?.excludeStablePlaceKeys ?? []).map((k) => String(k).trim()).filter((k) => k.length > 0),
  );
  const qRandom = diversifyLocalSearchQueryForVirtualPage(q, page);
  const places = await collectRandomUniqueLocalPlaces(qRandom, pageSize, exclude);

  const hasMore = places.length > 0 && page < NAVER_LOCAL_VIRTUAL_PAGE_CAP;

  return {
    places,
    nextPageToken: hasMore ? String(page + 1) : null,
  };
}
