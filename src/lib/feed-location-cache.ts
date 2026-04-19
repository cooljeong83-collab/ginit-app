import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LatLng } from '@/src/lib/geo-distance';

const KEY_LABEL = '@ginit/feed_last_location_label';
const KEY_LAT = '@ginit/feed_last_location_lat';
const KEY_LNG = '@ginit/feed_last_location_lng';

export type FeedLocationCache = {
  label: string;
  coords: LatLng | null;
};

/**
 * 피드에 마지막으로 쓴 구 라벨·좌표(거리 정렬용). 없으면 null.
 */
export async function loadFeedLocationCache(): Promise<FeedLocationCache | null> {
  try {
    const [[, label], [, latStr], [, lngStr]] = await AsyncStorage.multiGet([KEY_LABEL, KEY_LAT, KEY_LNG]);
    if (!label || !label.trim()) return null;
    const lat = latStr ? Number(latStr) : NaN;
    const lng = lngStr ? Number(lngStr) : NaN;
    const coords =
      Number.isFinite(lat) && Number.isFinite(lng) ? ({ latitude: lat, longitude: lng } satisfies LatLng) : null;
    return { label: label.trim(), coords };
  } catch {
    return null;
  }
}

export async function saveFeedLocationCache(label: string, coords: LatLng | null): Promise<void> {
  try {
    const pairs: [string, string][] = [[KEY_LABEL, label.trim()]];
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
