import { Linking, Platform } from 'react-native';

function buildGoogleMapsWebSearchUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude}%2C${longitude}`;
}

/** iOS·Android 구글 지도 앱 — 좌표 쿼리 */
function buildGoogleMapsAppUrl(latitude: number, longitude: number): string {
  return `comgooglemaps://?q=${latitude},${longitude}`;
}

/**
 * 구글 지도 앱을 열고, 실패 시 구글 지도 웹 검색으로 연결합니다.
 * @returns 열기 시도까지 성공하면 true
 */
export async function openGoogleMapAt(latitude: number, longitude: number, _queryLabel?: string): Promise<boolean> {
  const webUrl = buildGoogleMapsWebSearchUrl(latitude, longitude);
  if (Platform.OS === 'web') {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
  const appUrl = buildGoogleMapsAppUrl(latitude, longitude);
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
