import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';
import type { LatLng } from '@/src/lib/geo-distance';
import { getInterestRegionDisplayLabel } from '@/src/lib/korea-interest-districts';
import { seoulGuBboxCenter } from '@/src/lib/seoul-gu-bounds';
import { SEOUL_GU_SET, type SeoulGuLabel } from '@/src/lib/seoul-gu-constants';

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
export function approximateCenterLatLngForFeedRegionSync(normRaw: string): LatLng {
  const norm = normalizeFeedRegionLabel(normRaw.trim());
  if (!norm) return FEED_REGION_MAP_FALLBACK_CENTER;
  if (SEOUL_GU_SET.has(norm)) {
    return seoulGuBboxCenter(norm as SeoulGuLabel);
  }
  return FEED_REGION_MAP_FALLBACK_CENTER;
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
