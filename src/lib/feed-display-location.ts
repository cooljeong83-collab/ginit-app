import * as Location from 'expo-location';
import type { LocationGeocodedAddress } from 'expo-location';

/** 위치 권한 거부·역지오 실패 등일 때 피드 상단 기본 라벨(구 단위) */
export const FEED_LOCATION_FALLBACK_SHORT = '영등포구';

/** 피드/모임 탭 상단 표기용(시 + 구) */
export function formatSeoulGuLabel(gu: string): string {
  const g = (gu ?? '').trim();
  if (!g) return `서울시 ${FEED_LOCATION_FALLBACK_SHORT}`;
  if (g.includes('시')) return g;
  return `서울시 ${g}`;
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
 * (`서울시 강남구` → `강남구`, `경기도 성남시 분당구` → `분당구` 등)
 */
export function normalizeFeedRegionLabel(label: string): string {
  const t = label.trim();
  if (!t) return '';
  return extractGuFromKoreanAddressText(t) ?? t;
}

/**
 * 역지오코딩 결과에서 피드 헤더용 **구 이름만** 뽑습니다.
 */
export function guOnlyLabelFromGeocode(a: LocationGeocodedAddress): string {
  const city = (a.city ?? '').replace(/특별시|광역시|특별자치시|특별자치도/g, '').trim();
  const district = (a.district ?? '').trim();
  const sub = (a.subregion ?? '').trim();
  const street = (a.street ?? '').trim();
  const name = (a.name ?? '').trim();
  const formatted = (a.formattedAddress ?? '').trim();

  const pieces = [
    formatted,
    `${city} ${district}`.trim(),
    district,
    sub,
    street,
    name,
    `${sub} ${district}`.trim(),
  ];

  for (const piece of pieces) {
    const g = extractGuFromKoreanAddressText(piece);
    if (g) return g;
  }

  if (district && /구$/.test(district) && district.length <= 20) {
    const g = extractGuFromKoreanAddressText(district);
    if (g) return g;
    return district;
  }

  return '';
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
 * 위치 권한 한 번으로 좌표 + 구 라벨을 함께 반환합니다.
 */
export async function resolveFeedLocationContext(): Promise<FeedLocationContext> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { labelShort: FEED_LOCATION_FALLBACK_SHORT, coords: null };
    }

    const pos = await Location.getCurrentPositionAsync({
      // GPS + Wi‑Fi/셀룰러를 활용해 가능한 정확히(피드 상단 지역 표기/거리 정렬 기준).
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

export async function resolveFeedHeaderLocationLabel(): Promise<string> {
  const { labelShort } = await resolveFeedLocationContext();
  return labelShort;
}
