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
 * (네이버 지역 검색과 같은 개발용 프록시를 재사용합니다.)
 */
export function wrapGooglePlacesHttpsForWebFetch(absoluteHttpsUrl: string): string {
  if (Platform.OS !== 'web') return absoluteHttpsUrl;
  const proxyRaw = publicEnv.naverLocalSearchCorsProxy?.trim();
  if (!proxyRaw) return absoluteHttpsUrl;
  return `${normalizeCorsProxyBase(proxyRaw)}/${absoluteHttpsUrl}`;
}

type PlacesTextSearchJson = {
  places?: {
    photos?: { name?: string }[];
  }[];
};

/**
 * Google Places API(New) Text Search → 첫 장소의 첫 사진 미디어 URL.
 * GCP에서 **Places API(New)** 를 사용 설정한 API 키가 있어야 합니다.
 * `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` 권장, 없으면 `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` 폴백(키 제한에 따라 실패할 수 있음).
 *
 * @see https://developers.google.com/maps/documentation/places/web-service/text-search
 * @see https://developers.google.com/maps/documentation/places/web-service/place-photos
 */
export async function fetchGooglePlacePhotoMediaUrlFromTextQuery(textQuery: string): Promise<string | null> {
  const apiKey = resolveGooglePlacesRestApiKey();
  const q = textQuery.trim();
  if (!apiKey || !q) return null;

  const endpoint = wrapGooglePlacesHttpsForWebFetch('https://places.googleapis.com/v1/places:searchText');

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.photos',
      },
      body: JSON.stringify({ textQuery: q }),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let json: PlacesTextSearchJson;
  try {
    json = (await res.json()) as PlacesTextSearchJson;
  } catch {
    return null;
  }

  const photoName = json.places?.[0]?.photos?.[0]?.name?.trim();
  if (!photoName) return null;

  const mediaBase = `https://places.googleapis.com/v1/${photoName}/media`;
  const params = new URLSearchParams({
    maxHeightPx: '512',
    maxWidthPx: '512',
    key: apiKey,
  });
  const absolute = `${mediaBase}?${params.toString()}`;
  const uri = wrapGooglePlacesHttpsForWebFetch(absolute);
  if (!uri.startsWith('https://')) return null;
  return uri;
}
