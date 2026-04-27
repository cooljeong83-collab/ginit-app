import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LatLng } from '@/src/lib/geo-distance';

const KEY_LABEL = '@ginit/feed_last_location_label';
const KEY_LAT = '@ginit/feed_last_location_lat';
const KEY_LNG = '@ginit/feed_last_location_lng';
/** `'1'`이면 지역 모달에서 고른 값 — 앱 재실행 후 GPS와 달라도 해당 라벨 유지 */
const KEY_MANUAL = '@ginit/feed_last_location_manual';

export type FeedLocationCache = {
  label: string;
  coords: LatLng | null;
  manualRegionPicked?: boolean;
};

/**
 * 피드에 마지막으로 쓴 구 라벨·좌표(거리 정렬용). 없으면 null.
 */
export async function loadFeedLocationCache(): Promise<FeedLocationCache | null> {
  try {
    const [[, label], [, latStr], [, lngStr], [, manualStr]] = await AsyncStorage.multiGet([
      KEY_LABEL,
      KEY_LAT,
      KEY_LNG,
      KEY_MANUAL,
    ]);
    if (!label || !label.trim()) return null;
    const lat = latStr ? Number(latStr) : NaN;
    const lng = lngStr ? Number(lngStr) : NaN;
    const coords =
      Number.isFinite(lat) && Number.isFinite(lng) ? ({ latitude: lat, longitude: lng } satisfies LatLng) : null;
    const manualRegionPicked = manualStr === '1';
    return { label: label.trim(), coords, manualRegionPicked };
  } catch {
    return null;
  }
}

export async function saveFeedLocationCache(
  label: string,
  coords: LatLng | null,
  opts?: { manualRegion?: boolean },
): Promise<void> {
  try {
    const pairs: [string, string][] = [
      [KEY_LABEL, label.trim()],
      [KEY_MANUAL, opts?.manualRegion ? '1' : '0'],
    ];
    if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) {
      pairs.push([KEY_LAT, String(coords.latitude)], [KEY_LNG, String(coords.longitude)]);
    } else {
      pairs.push([KEY_LAT, ''], [KEY_LNG, '']);
    }
    await AsyncStorage.multiSet(pairs);
  } catch {
    /* 저장 실패는 피드 동작에 영향 없음 */
  }
}
