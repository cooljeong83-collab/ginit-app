import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
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

/** 상호·주소·카테고리로 네이버 **모바일 통합검색**(m.search) 검색어를 만듭니다. `link`는 사용하지 않습니다. */
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
  const primary = [title, addrForQuery].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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
 * 상호명 + 주소(행정 **구** 단위까지 잘린 한 줄, 또는 카테고리) 검색 결과를 띄웁니다. API `link`는 검색어에 쓰지 않습니다.
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
 * 모임 상세 **장소 투표 칩**(`naverPlaceLink`는 무시·한 줄 `address` + 제목)과 동일한 인자로
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
  items?: {
    title?: string;
    address?: string;
    roadAddress?: string;
    category?: string;
    mapx?: string;
    mapy?: string;
    link?: string;
  }[];
};

/**
 * 지역 검색 JSON → 목록용 플레이스 (좌표는 선택 후 Geocoding으로만 채움).
 * @see https://developers.naver.com/docs/serviceapi/search/local/local.md
 */
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
 */
async function fetchOpenApiLocalSearch(
  query: string,
  opts?: { display?: number; start?: number },
): Promise<NaverOpenApiLocalJson> {
  const id = publicEnv.naverSearchClientId?.trim();
  const secret = publicEnv.naverSearchClientSecret?.trim();
  if (!id || !secret) {
    throw new Error(
      '지역 검색(상호)용 키가 없습니다. env에 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID와 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET을 설정하세요.',
    );
  }

  const q = query.trim();
  const display = Math.min(10, Math.max(1, Math.floor(opts?.display ?? 5)));
  const start = Math.max(1, Math.floor(opts?.start ?? 1));
  const baseUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=${display}&start=${start}&sort=comment`;

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
    return (await res.json()) as NaverOpenApiLocalJson;
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
