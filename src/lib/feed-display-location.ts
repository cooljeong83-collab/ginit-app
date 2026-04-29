import * as Location from 'expo-location';
import type { LocationGeocodedAddress } from 'expo-location';

import { ensureForegroundLocationPermissionWithSettingsFallback } from '@/src/lib/location-permission';
import { SEOUL_GU_SET } from '@/src/lib/seoul-gu-constants';

/** 위치 권한 거부·역지오 실패 등일 때 피드 상단 기본 라벨(구 단위) */
export const FEED_LOCATION_FALLBACK_SHORT = '영등포구';

function shortCityLabelFromGeocodeCity(cityRaw: string): string {
  let s = cityRaw.trim();
  if (!s) return '';
  s = s.replace(/특별시|광역시|특별자치시|특별자치도/g, '').trim();
  s = s.replace(/도$/g, '').trim();
  s = s.replace(/시$/g, '').trim();
  return s;
}

/** 주소 문자열에서 7대 광역·세종·서울 행정단위명을 찾아 `guOnlyLabelFromGeocode`의 `city` 보강에 사용 */
const METRO_SUBSTRINGS_ORDERED = [
  '서울특별시',
  '세종특별자치시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '광주광역시',
  '대전광역시',
  '울산광역시',
  '서울',
  '세종',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
] as const;

const METRO_SUBSTRING_TO_CITYRAW: Record<string, string> = {
  서울특별시: '서울특별시',
  서울: '서울특별시',
  세종특별자치시: '세종특별자치시',
  세종: '세종특별자치시',
  부산광역시: '부산광역시',
  부산: '부산광역시',
  대구광역시: '대구광역시',
  대구: '대구광역시',
  인천광역시: '인천광역시',
  인천: '인천광역시',
  광주광역시: '광주광역시',
  광주: '광주광역시',
  대전광역시: '대전광역시',
  대전: '대전광역시',
  울산광역시: '울산광역시',
  울산: '울산광역시',
};

function inferMetroCityRawFromKoreanBlob(blob: string): string {
  const b = blob.replace(/\s+/g, ' ').trim();
  if (!b) return '';
  for (const key of METRO_SUBSTRINGS_ORDERED) {
    if (b.includes(key)) return METRO_SUBSTRING_TO_CITYRAW[key] ?? '';
  }
  return '';
}

/**
 * 피드 상단 표시 전용: 축약 시명(`인천`) → `인천시` (저장·normalize는 `인천 서구` 형태 유지)
 */
function metroCityTokenForDisplay(shortCity: string): string {
  const s = shortCity.trim();
  if (!s) return '';
  const map: Record<string, string> = {
    서울: '서울시',
    부산: '부산시',
    대구: '대구시',
    인천: '인천시',
    광주: '광주시',
    대전: '대전시',
    울산: '울산시',
    세종: '세종시',
  };
  if (map[s]) return map[s]!;
  if (/시$/.test(s)) return s;
  return s;
}

function isSeoulAdminFromGeocodeCity(cityRaw: string): boolean {
  const c = cityRaw.trim();
  if (!c) return false;
  if (/서울/i.test(c)) return true;
  return /^seoul$/i.test(c);
}

/**
 * 피드/모임 탭 상단 표기용(서울은 `서울시 ○○구`, 광역은 `인천시 ○○구` 등).
 * @param locationHintForDisplay GPS 기준 전체 라벨(예: `actualLocationLabel`). 캐시에 `서구`만 있을 때 시·광역 접두 복구에 사용.
 */
export function formatSeoulGuLabel(label: string, locationHintForDisplay?: string): string {
  const raw = (label ?? '').trim();
  if (!raw) return `서울시 ${FEED_LOCATION_FALLBACK_SHORT}`;

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const endsGu = /구$/.test(last) && last.length >= 2;
    if (endsGu && !/^서울/i.test(first) && !/^seoul$/i.test(first)) {
      if (parts.length === 2) {
        const cityDisp = metroCityTokenForDisplay(shortCityLabelFromGeocodeCity(first));
        return `${cityDisp} ${last}`.trim();
      }
      return raw;
    }
    if (endsGu && (/^서울/i.test(first) || /^seoul$/i.test(first))) {
      const g = extractGuFromKoreanAddressText(last) ?? last;
      return `서울시 ${g}`;
    }
  }

  const token = parts.length === 1 ? parts[0]! : extractGuFromKoreanAddressText(raw) ?? raw;
  if (!token) return `서울시 ${FEED_LOCATION_FALLBACK_SHORT}`;
  if (SEOUL_GU_SET.has(token)) return `서울시 ${token}`;

  const hint = (locationHintForDisplay ?? '').trim();
  if (hint && /구$/.test(token) && token.length >= 2 && !SEOUL_GU_SET.has(token) && hint.includes(token)) {
    const inferred = inferMetroCityRawFromKoreanBlob(hint);
    if (inferred) {
      const short = shortCityLabelFromGeocodeCity(inferred);
      if (short) return `${metroCityTokenForDisplay(short)} ${token}`.trim();
    }
  }

  return token;
}

/**
 * 한국 주소 문자열에서 첫 번째 `○○구` 행정구명을 추출합니다.
 *
 * ECMAScript에서 `\b`는 한글을 단어 문자로 보지 않아 `…구\b` 패턴이 거의 항상 실패합니다.
 * `중구`처럼 구명 앞 글자가 한 자인 경우도 포함하려면 `{1,}` 길이가 필요합니다.
 */
export function extractGuFromKoreanAddressText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/([가-힣]{1,20}구)(?=\s|$|[^가-힣])/);
  return m ? m[1] : null;
}

/**
 * 피드·캐시에 저장된 지역 문자열을 탐색 필터용으로 맞춥니다.
 * (`서울시 강남구` → `강남구`, `경기도 성남시 분당구` → `분당구` 등).
 * 비서울 광역 `인천 서구`처럼 시·군 축약 + 구 두 토큰은 그대로 유지합니다.
 */
export function normalizeFeedRegionLabel(label: string): string {
  const t = label.trim();
  if (!t) return '';
  const two = t.split(/\s+/).filter(Boolean);
  if (two.length === 2 && /구$/.test(two[1]!) && two[1]!.length >= 2 && !/^서울/i.test(two[0]!) && !/^seoul$/i.test(two[0]!)) {
    return t;
  }
  return extractGuFromKoreanAddressText(t) ?? t;
}

/**
 * 모임 주소·장소 문자열이 피드/지도에 선택된 지역(`normalizeFeedRegionLabel` 기준)과 맞는지 판별합니다.
 */
export function haystackMatchesFeedRegion(hayRaw: string, regionLabel: string): boolean {
  const sel = normalizeFeedRegionLabel(regionLabel);
  if (!sel) return true;
  const hay = hayRaw.replace(/\s+/g, ' ').trim();
  if (!hay) return false;

  const parts = sel.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && /구$/.test(parts[1]!) && !/^서울/i.test(parts[0]!) && !/^seoul$/i.test(parts[0]!)) {
    const [cityShort, gu] = parts as [string, string];
    if (!hay.includes(gu)) return false;
    return hay.includes(cityShort);
  }

  const selGu = extractGuFromKoreanAddressText(sel) ?? sel;
  const mGu = extractGuFromKoreanAddressText(hay);
  if (mGu && selGu.endsWith('구')) return mGu === selGu;
  return hay.includes(sel) || hay.includes(selGu);
}

/**
 * 역지오코딩 결과에서 피드 헤더용 라벨을 뽑습니다.
 * 서울 행정구는 `○○구`만, 그 외(예: 인천 서구)는 시·광역 단위 축약 + 구 형태로 구분합니다.
 */
export function guOnlyLabelFromGeocode(a: LocationGeocodedAddress): string {
  const blobForMetro = [a.formattedAddress, a.name, a.region, a.subregion, a.district, a.street].filter(Boolean).join(' ');
  const cityRaw = (a.city ?? '').trim() || inferMetroCityRawFromKoreanBlob(blobForMetro);
  const cityStripped = cityRaw.replace(/특별시|광역시|특별자치시|특별자치도/g, '').trim();
  const district = (a.district ?? '').trim();
  const sub = (a.subregion ?? '').trim();
  const street = (a.street ?? '').trim();
  const name = (a.name ?? '').trim();
  const formatted = (a.formattedAddress ?? '').trim();

  const pieces = [
    formatted,
    `${cityStripped} ${district}`.trim(),
    district,
    sub,
    street,
    name,
    `${sub} ${district}`.trim(),
  ];

  for (const piece of pieces) {
    const g = extractGuFromKoreanAddressText(piece);
    if (g) return withCityPrefixIfNeeded(g, cityRaw);
  }

  if (district && /구$/.test(district) && district.length <= 20) {
    const g = extractGuFromKoreanAddressText(district);
    if (g) return withCityPrefixIfNeeded(g, cityRaw);
    return withCityPrefixIfNeeded(district, cityRaw);
  }

  return '';
}

function withCityPrefixIfNeeded(gu: string, cityRaw: string): string {
  const g = gu.trim();
  const city = cityRaw.trim();
  if (!g) return '';
  if (city && isSeoulAdminFromGeocodeCity(city)) {
    return g;
  }
  if (city && !isSeoulAdminFromGeocodeCity(city)) {
    const shortCity = shortCityLabelFromGeocodeCity(city);
    if (shortCity) return `${shortCity} ${g}`.trim();
  }
  return g;
}

/**
 * 현재 좌표를 받아 역지오코딩한 뒤 **구** 단위 라벨을 반환합니다.
 * 실패 시 `FEED_LOCATION_FALLBACK_SHORT`.
 */
export type FeedLocationContext = {
  /** 피드 상단 구 이름 */
  labelShort: string;
  /** 거리 계산용 (권한·좌표 실패 시 null) */
  coords: { latitude: number; longitude: number } | null;
};

/**
 * 이미 포그라운드 위치 권한이 허용된 상태에서만 호출합니다.
 * GPS + 역지오코딩(피드 상단 지역·거리 정렬 기준).
 */
export async function resolveFeedLocationWithGrantedPermission(): Promise<FeedLocationContext> {
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const coords = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };

    const results = await Location.reverseGeocodeAsync(coords);
    const first = results[0];
    const label = first ? guOnlyLabelFromGeocode(first).trim() : '';

    return {
      labelShort: label || FEED_LOCATION_FALLBACK_SHORT,
      coords,
    };
  } catch {
    return { labelShort: FEED_LOCATION_FALLBACK_SHORT, coords: null };
  }
}

/**
 * 위치 권한 요청 후, 허용이면 좌표·구 라벨을 함께 반환합니다.
 * 거부 시 접속 지역은 `FEED_LOCATION_FALLBACK_SHORT`(영등포구)만 사용합니다.
 */
export async function resolveFeedLocationContext(): Promise<FeedLocationContext> {
  try {
    const perm = await ensureForegroundLocationPermissionWithSettingsFallback({
      title: '위치 권한이 필요해요',
      message: '피드에서 내 주변 모임 거리/지역을 보여주려면 위치 권한을 허용해 주세요.',
    });
    if (!perm.granted) {
      return { labelShort: FEED_LOCATION_FALLBACK_SHORT, coords: null };
    }
    return await resolveFeedLocationWithGrantedPermission();
  } catch {
    return { labelShort: FEED_LOCATION_FALLBACK_SHORT, coords: null };
  }
}

export async function resolveFeedHeaderLocationLabel(): Promise<string> {
  const { labelShort } = await resolveFeedLocationContext();
  return labelShort;
}
