import type { Region as NaverMapRegion } from '@mj-studio/react-native-naver-map';

/** Google / react-native-maps 스타일(중심 + delta) */
export type CenterLatLngRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * 네이버 맵 `Region`은 south-west 모서리 + delta.
 * @see `@mj-studio/react-native-naver-map` Region 문서
 */
export function centerRegionToNaverRegion(r: CenterLatLngRegion): NaverMapRegion {
  return {
    latitude: r.latitude - r.latitudeDelta / 2,
    longitude: r.longitude - r.longitudeDelta / 2,
    latitudeDelta: r.latitudeDelta,
    longitudeDelta: r.longitudeDelta,
  };
}
