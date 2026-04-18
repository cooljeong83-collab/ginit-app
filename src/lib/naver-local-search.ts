import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
import {
  geocodeNaverMapsAddress,
  withCorsProxyForWeb,
  type NaverMapsGeocodeAddress,
  type NaverMapsGeocodeResponse,
} from '@/src/lib/naver-ncp-maps';

export type NaverLocalPlace = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** 지역 검색 직후에는 null — 항목 선택 시 NCP Geocoding으로 채움 */
  latitude: number | null;
  longitude: number | null;
};

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
    out.push({
      id: `local-${mapx}-${mapy}-${idx}`,
      title,
      address,
      roadAddress,
      category,
      latitude: null,
      longitude: null,
    });
  });
  return out;
}

/**
 * openapi 지역 검색 — **X-Naver-Client-Id / X-Naver-Client-Secret 만** (Search API 전용 키).
 */
async function fetchOpenApiLocalSearch(query: string): Promise<NaverOpenApiLocalJson> {
  const id = publicEnv.naverSearchClientId?.trim();
  const secret = publicEnv.naverSearchClientSecret?.trim();
  if (!id || !secret) {
    throw new Error(
      '지역 검색(상호)용 키가 없습니다. env에 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID와 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET을 설정하세요.',
    );
  }

  const q = query.trim();
  const baseUrl = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=5&sort=comment`;

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

/**
 * 1) Search API 지역 검색 (openapi, X-Naver-*).
 * 2) 결과가 없으면 NCP Geocoding으로 쿼리 자체를 주소처럼 조회.
 */
export async function searchNaverLocalPlaces(query: string): Promise<NaverLocalPlace[]> {
  const q = query.trim();
  if (!q) return [];

  const hasSearchKeys = Boolean(
    publicEnv.naverSearchClientId?.trim() && publicEnv.naverSearchClientSecret?.trim(),
  );

  if (hasSearchKeys) {
    try {
      const json = await fetchOpenApiLocalSearch(q);
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
