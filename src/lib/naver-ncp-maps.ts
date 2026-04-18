import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';

/**
 * Application Maps(VPC) 공통 호스트 — NCP 문서: Geocoding 베이스가 `https://maps.apigw.ntruss.com/map-geocode/v2`.
 * @see https://api.ncloud-docs.com/docs/application-maps-overview
 * (다른 상품/게이트웨이용 키로 호출하면 401·210이 날 수 있음 → `EXPO_PUBLIC_NAVER_MAPS_API_ORIGIN`으로 조정)
 */
export const DEFAULT_NAVER_MAPS_ORIGIN = 'https://maps.apigw.ntruss.com';

/**
 * NCP Geocoding — env → 헤더 매핑
 * @see https://api.ncloud-docs.com/docs/application-maps-overview (요청 헤더)
 * @see https://api.ncloud-docs.com/docs/application-maps-geocoding (Geocoding 상세)
 *
 * | .env / `expo.extra` (우선순위는 app.config.ts `pickExtra`) | HTTP 헤더 |
 * |---|---|
 * | `NAVER_LOCAL_CLIENT_ID` 또는 `EXPO_PUBLIC_NAVER_LOCAL_CLIENT_ID` (없으면 지도용 `NAVER_MAP_CLIENT_ID` 등) | `X-NCP-APIGW-API-KEY-ID` |
 * | `NAVER_LOCAL_CLIENT_SECRET` 또는 `EXPO_PUBLIC_NAVER_LOCAL_CLIENT_SECRET` | `X-NCP-APIGW-API-KEY` |
 *
 * 실제 값은 `publicEnv.naverLocalClientId` / `naverLocalClientSecret` → `ncpApigwHeaders()` 로만 전달됩니다.
 *
 * 호출 URL: 오리진(`naverMapsApiOrigin`, 기본 `https://maps.apigw.ntruss.com`) + 경로(`naverMapsGeocodePath`).
 * Geocoding 리소스는 **`/map-geocode/v2/geocode`** (`.../map-geocoding/v2/search` 는 문서에 없음).
 */
const HEADER_NCP_KEY_ID = 'X-NCP-APIGW-API-KEY-ID';
const HEADER_NCP_API_KEY = 'X-NCP-APIGW-API-KEY';

export function ncpApigwHeaders(apiKeyId: string, apiKey: string): Record<string, string> {
  return {
    [HEADER_NCP_KEY_ID]: apiKeyId.trim(),
    [HEADER_NCP_API_KEY]: apiKey.trim(),
    Accept: 'application/json',
  };
}

export type NaverMapsGeocodeAddress = {
  roadAddress?: string;
  jibunAddress?: string;
  englishAddress?: string;
  addressElements?: {
    types?: string[];
    /** 일부 응답/문서 표기는 `type` 배열 */
    type?: string | string[];
    longName?: string;
    shortName?: string;
    code?: string;
  }[];
  /** 경도·위도 — JSON이 문자열 또는 숫자로 올 수 있음 */
  x?: string | number;
  y?: string | number;
  distance?: number;
};

export type NaverMapsGeocodeResponse = {
  status?: string;
  meta?: { totalCount?: number; page?: number; count?: number };
  addresses?: NaverMapsGeocodeAddress[];
  errorMessage?: string;
};

function normalizeMapsOrigin(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '');
  return t || DEFAULT_NAVER_MAPS_ORIGIN;
}

/** cors-anywhere 등: `https://cors-anywhere.herokuapp.com/` → 끝 슬래시 제거 후 `프록시/https://대상...` */
export function normalizeCorsProxyBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** 웹에서 절대 URL 앞에 CORS 프록시를 붙입니다. 네이티브는 URL 그대로 반환합니다. */
export function withCorsProxyForWeb(absoluteHttpsUrl: string): string {
  if (Platform.OS !== 'web') return absoluteHttpsUrl;
  const proxyRaw = publicEnv.naverLocalSearchCorsProxy?.trim();
  if (!proxyRaw) {
    throw new Error('CORS_PROXY_REQUIRED');
  }
  return `${normalizeCorsProxyBase(proxyRaw)}/${absoluteHttpsUrl}`;
}

type NcpGatewayErrorBody = {
  error?: { errorCode?: string; message?: string; details?: string };
};

function parseNcpGatewayError(text: string): NcpGatewayErrorBody['error'] | null {
  try {
    const j = JSON.parse(text) as NcpGatewayErrorBody;
    return j.error ?? null;
  } catch {
    return null;
  }
}

/** HTTP 실패 시 본문(errorCode)을 읽어 콘솔 조치 안내 */
function formatNcpMapsHttpError(status: number, bodyText: string): string {
  const err = parseNcpGatewayError(bodyText);
  const code = err?.errorCode;
  const message = err?.message ?? '';
  const details = err?.details ?? '';

  if (status === 401 && code === '210') {
    return [
      '이 Application 키로 현재 호출 중인 Maps 게이트웨이에 Geocoding이 허용되지 않았거나, 호스트가 콘솔 상품과 맞지 않을 수 있습니다.',
      'Application Maps(VPC) 문서 기준 Geocoding 호스트는 https://maps.apigw.ntruss.com 입니다. 앱 기본값이 이와 같습니다. 예전 호스트(naveropenapi.apigw.ntruss.com)용 키/설정이면 EXPO_PUBLIC_NAVER_MAPS_API_ORIGIN을 콘솔·문서와 동일하게 맞추세요.',
      '콘솔에서 해당 Application [수정] → 사용 API에 Geocoding이 체크되어 있는지 확인하고, 그 앱에서 발급한 Client ID / Client Secret을 env에 넣어 주세요.',
      '문서: https://api.ncloud-docs.com/docs/application-maps-overview · https://guide.ncloud-docs.com/docs/maps-overview',
      message || details ? `(${[message, details].filter(Boolean).join(' — ')})` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  if (status === 401 && code === '200') {
    return [
      'NCP API 인증에 실패했습니다. Client ID/Secret이 호출 URL의 게이트웨이(Application: maps.apigw.ntruss.com 등)에 맞는지, X-NCP-APIGW-API-KEY-ID·KEY 공백·복사 오류가 없는지 확인하세요.',
      message ? `(${message})` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return `네이버 Maps API 오류 (${status}): ${bodyText.slice(0, 300)}`;
}

/**
 * `pathAndQuery`는 `/`로 시작하는 경로+쿼리 (Geocoding 예: `/map-geocode/v2/geocode?query=...`).
 * 웹: `EXPO_PUBLIC_NAVER_LOCAL_SEARCH_CORS_PROXY`(예: https://cors-anywhere.herokuapp.com/) +
 * 수정된 **전체** 절대 URL(예: `https://maps.apigw.ntruss.com/...`)을 `/` 한 개로 이어 붙임.
 */
export async function fetchNaverMapsJson<T>(
  pathAndQuery: string,
  opts: { apiKeyId: string; apiKey: string },
): Promise<T> {
  const origin = normalizeMapsOrigin(publicEnv.naverMapsApiOrigin);
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  let url = `${origin}${path}`;

  if (Platform.OS === 'web') {
    const proxyRaw = publicEnv.naverLocalSearchCorsProxy?.trim();
    if (!proxyRaw) {
      throw new Error(
        '웹에서는 NCP Maps API가 CORS로 차단될 수 있습니다. EXPO_PUBLIC_NAVER_LOCAL_SEARCH_CORS_PROXY(예: https://cors-anywhere.herokuapp.com/)를 설정하거나 네이티브에서 테스트하세요.',
      );
    }
    const proxy = normalizeCorsProxyBase(proxyRaw);
    url = `${proxy}/${url}`;
  }

  const headers = ncpApigwHeaders(opts.apiKeyId, opts.apiKey);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(formatNcpMapsHttpError(res.status, t));
  }
  return (await res.json()) as T;
}

/**
 * 주소/장소 키워드 지오코딩 (NCP Maps, X-NCP-* 헤더만).
 * @param count 1~100 (NCP Geocoding 규격)
 */
export async function geocodeNaverMapsAddress(query: string, count = 10): Promise<NaverMapsGeocodeResponse> {
  const q = query.trim();
  if (!q) {
    return { status: 'OK', addresses: [] };
  }

  const apiKeyId = publicEnv.naverLocalClientId || publicEnv.naverMapClientId;
  const apiKey = publicEnv.naverLocalClientSecret;
  if (!apiKeyId || !apiKey) {
    throw new Error(
      'NCP Maps API용 Client ID/Secret이 없습니다. env/.env에 NAVER_LOCAL_CLIENT_SECRET 및 NAVER_LOCAL_CLIENT_ID(또는 지도용 ID)를 설정하세요.',
    );
  }

  const capped = Math.min(100, Math.max(1, count));
  const pathBaseRaw = (publicEnv.naverMapsGeocodePath || '/map-geocode/v2/geocode').trim();
  const pathBase = pathBaseRaw.startsWith('/') ? pathBaseRaw : `/${pathBaseRaw}`;
  const path = `${pathBase}?query=${encodeURIComponent(q)}&count=${capped}`;
  return fetchNaverMapsJson<NaverMapsGeocodeResponse>(path, { apiKeyId, apiKey });
}
