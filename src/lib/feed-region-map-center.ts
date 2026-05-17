import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';
import { haversineDistanceMeters, type LatLng } from '@/src/lib/geo-distance';
import { getInterestRegionDisplayLabel } from '@/src/lib/korea-interest-districts';
import { SEOUL_GU_LATLNG_BOUNDS, seoulGuBboxCenter } from '@/src/lib/seoul-gu-bounds';
import { SEOUL_GU_SET, type SeoulGuLabel } from '@/src/lib/seoul-gu-constants';

/** react-native-maps `Region`과 동일한 WGS84 뷰포트(지도 카메라) */
export type FeedRegionMapViewport = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/** 구 bbox·비서울 관심 지역에 여유를 두고 전체가 보이도록 하는 패딩 */
const FEED_REGION_VIEWPORT_PAD = 1.14;

function regionFromCenterAndSpan(
  lat: number,
  lng: number,
  latSpanDeg: number,
  lngSpanDeg: number,
): FeedRegionMapViewport {
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: Math.min(0.42, Math.max(0.008, latSpanDeg)),
    longitudeDelta: Math.min(0.48, Math.max(0.008, lngSpanDeg)),
  };
}

/** 위치 권한 없을 때 탐색 지도 기본 중심(영등포구 부근) */
export const FEED_REGION_MAP_FALLBACK_CENTER: LatLng = { latitude: 37.5263, longitude: 126.8962 };

/**
 * 모임 탭 «표시 중인 관심 지역» 정규화 키(예: `강남구`, `인천 서구`)에 대응하는 대략적 지도 중심(WGS84).
 * 서울 25구는 bbox 중심, 그 외는 `getInterestRegionDisplayLabel` 문자열로 지오코딩(실패 시 폴백).
 */
/**
 * 지도 첫 프레임용: 서울 25구는 bbox 중심을 동기 반환, 그 외는 지오코딩 전까지 폴백 좌표.
 * `approximateCenterLatLngForFeedRegion`(비동기)로 이후 정밀 보정 가능.
 */
/** 등록된 관심 지역 중 WGS84 기준으로 `user`와 가장 가까운 구(정규화 키). */
export function closestRegisteredFeedRegionNorm(regions: readonly string[], user: LatLng): string | null {
  if (regions.length === 0) return null;
  let bestNorm = normalizeFeedRegionLabel(regions[0]!);
  let bestM = Number.POSITIVE_INFINITY;
  for (const raw of regions) {
    const norm = normalizeFeedRegionLabel(raw);
    if (!norm) continue;
    const center = approximateCenterLatLngForFeedRegionSync(norm);
    const d = haversineDistanceMeters(user, center);
    if (d < bestM) {
      bestM = d;
      bestNorm = norm;
    }
  }
  return bestNorm;
}

export function approximateCenterLatLngForFeedRegionSync(normRaw: string): LatLng {
  const norm = normalizeFeedRegionLabel(normRaw.trim());
  if (!norm) return FEED_REGION_MAP_FALLBACK_CENTER;
  if (SEOUL_GU_SET.has(norm)) {
    return seoulGuBboxCenter(norm as SeoulGuLabel);
  }
  return FEED_REGION_MAP_FALLBACK_CENTER;
}

/**
 * 관심 구(정규화 라벨) 전체가 지도에 들어오도록 하는 뷰포트.
 * 서울 25구는 KOSTAT bbox, 그 외는 중심 기준 넓은 원형 뷰(지오코딩 전 동기 중심).
 */
export function regionViewportForFeedInterestRegion(normRaw: string): FeedRegionMapViewport {
  const norm = normalizeFeedRegionLabel(normRaw.trim());
  if (!norm) {
    return regionFromCenterAndSpan(
      FEED_REGION_MAP_FALLBACK_CENTER.latitude,
      FEED_REGION_MAP_FALLBACK_CENTER.longitude,
      0.036,
      0.042,
    );
  }
  if (SEOUL_GU_SET.has(norm)) {
    const b = SEOUL_GU_LATLNG_BOUNDS[norm as SeoulGuLabel];
    const latSpan = (b.latMax - b.latMin) * FEED_REGION_VIEWPORT_PAD;
    const lngSpan = (b.lngMax - b.lngMin) * FEED_REGION_VIEWPORT_PAD;
    return regionFromCenterAndSpan((b.latMin + b.latMax) / 2, (b.lngMin + b.lngMax) / 2, latSpan, lngSpan);
  }
  const center = approximateCenterLatLngForFeedRegionSync(norm);
  const radiusKm = 8;
  const metersPerDegLat = 111320;
  const dLat = Math.min(0.42, ((radiusKm * 1000) * 2.25) / metersPerDegLat);
  const cosLat = Math.cos((center.latitude * Math.PI) / 180);
  const dLng = Math.min(0.48, dLat / Math.max(0.22, Math.abs(cosLat)));
  return regionFromCenterAndSpan(center.latitude, center.longitude, dLat, dLng);
}

export type FeedInterestMapLayoutMetrics = {
  topInsetPx: number;
  bottomSheetPx: number;
  windowHeight: number;
};

/** 바텀 시트·상단 글래스 바를 고려해 마커가 가운데에 오도록 위도 보정 */
export function centerLatForMapSheetAndTopChrome(
  targetLat: number,
  baseDeltaLat: number,
  topInsetPx: number,
  bottomSheetPx: number,
  windowH: number,
): number {
  const bottomFrac = Math.max(0, Math.min(0.9, bottomSheetPx / Math.max(1, windowH)));
  const topOverlayPx = Math.max(0, topInsetPx);
  const topFrac = Math.max(0, Math.min(0.4, topOverlayPx / Math.max(1, windowH)));
  const desiredY = (topFrac + (1 - bottomFrac)) / 2;
  const yShiftFrac = 0.5 - desiredY;
  return targetLat - baseDeltaLat * yShiftFrac;
}

/** 관심 구 기준 카메라·조회 박스(동기) — 홈 탐색 필터와 지도 마커/시트 SSOT */
export function buildCameraRegionForFeedInterestNorm(
  normRaw: string,
  center: LatLng,
  layout?: FeedInterestMapLayoutMetrics,
): FeedRegionMapViewport {
  const viewport = regionViewportForFeedInterestRegion(normRaw);
  const latitude = layout
    ? centerLatForMapSheetAndTopChrome(
        center.latitude,
        viewport.latitudeDelta,
        layout.topInsetPx,
        layout.bottomSheetPx,
        layout.windowHeight,
      )
    : center.latitude;
  return {
    latitude,
    longitude: center.longitude,
    latitudeDelta: viewport.latitudeDelta,
    longitudeDelta: viewport.longitudeDelta,
  };
}

export async function approximateCenterLatLngForFeedRegion(normRaw: string): Promise<LatLng> {
  const norm = normalizeFeedRegionLabel(normRaw.trim());
  if (!norm) return FEED_REGION_MAP_FALLBACK_CENTER;
  if (SEOUL_GU_SET.has(norm)) {
    return seoulGuBboxCenter(norm as SeoulGuLabel);
  }
  if (Platform.OS === 'web') return FEED_REGION_MAP_FALLBACK_CENTER;
  const query = getInterestRegionDisplayLabel(norm);
  try {
    const results = await Location.geocodeAsync(query);
    const first = results[0];
    if (first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
      return { latitude: first.latitude, longitude: first.longitude };
    }
  } catch {
    /* ignore */
  }
  return FEED_REGION_MAP_FALLBACK_CENTER;
}
