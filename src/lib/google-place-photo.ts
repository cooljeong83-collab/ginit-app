import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
import { normalizeCorsProxyBase } from '@/src/lib/naver-ncp-maps';

export function resolveGooglePlacesRestApiKey(): string {
  const a = publicEnv.googlePlacesApiKey?.trim() ?? '';
  const b = publicEnv.googleMapsPlatformApiKey?.trim() ?? '';
  return a || b;
}

/**
 * 웹에서 CORS가 막힐 때 `EXPO_PUBLIC_NAVER_LOCAL_SEARCH_CORS_PROXY`와 동일 규칙으로 프록시 URL을 붙입니다.
 * (레거시 Google Places URL용 — 장소 검색은 Kakao 로컬 API로 전환됨.)
 */
export function wrapGooglePlacesHttpsForWebFetch(absoluteHttpsUrl: string): string {
  if (Platform.OS !== 'web') return absoluteHttpsUrl;
  const proxyRaw = publicEnv.naverLocalSearchCorsProxy?.trim();
  if (!proxyRaw) return absoluteHttpsUrl;
  return `${normalizeCorsProxyBase(proxyRaw)}/${absoluteHttpsUrl}`;
}
