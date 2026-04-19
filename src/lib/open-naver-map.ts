import { Linking, Platform } from 'react-native';

/** 모바일 웹·브라우저용 네이버 지도(새 지도) 중심 링크 */
export function buildNaverMapWebUrl(latitude: number, longitude: number, zoom = 16): string {
  return `https://map.naver.com/v5/?c=${longitude},${latitude},${zoom},0,0,0,dh`;
}

/** 네이버 지도 앱 — 장소 보기 스킴 */
export function buildNaverMapAppPlaceUrl(latitude: number, longitude: number, placeName?: string): string {
  const name = encodeURIComponent(placeName?.trim() || '장소');
  return `nmap://place?lat=${latitude}&lng=${longitude}&name=${name}`;
}

/**
 * 해당 좌표를 네이버 지도 앱에서 열고, 실패 시 네이버 지도 웹을 엽니다.
 * @returns 열기 시도까지 성공하면 true
 */
export async function openNaverMapAt(latitude: number, longitude: number, placeName?: string): Promise<boolean> {
  const webUrl = buildNaverMapWebUrl(latitude, longitude);
  if (Platform.OS === 'web') {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
  const appUrl = buildNaverMapAppPlaceUrl(latitude, longitude, placeName);
  try {
    await Linking.openURL(appUrl);
    return true;
  } catch {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
}
