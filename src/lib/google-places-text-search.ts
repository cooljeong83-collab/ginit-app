import {
  resolveGooglePlacesRestApiKey,
  wrapGooglePlacesHttpsForWebFetch,
} from '@/src/lib/google-place-photo';

/** Places API(New) Text Search 한 행 — 기존 `NaverLocalPlace`와 동일 필드 + 썸네일 */
export type PlaceSearchRow = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** `googleMapsUri` 등 외부 지도 링크 */
  link?: string;
  latitude: number | null;
  longitude: number | null;
  /** 첫 장소 사진 미디어 URL(있으면 별도 이미지 검색 생략 가능) */
  thumbnailUrl?: string | null;
};

export type SearchPlacesTextOptions = {
  /** 네이버 시절과 동일: 좌표 없을 때 쿼리 끝에 붙는 지역 힌트 문자열 */
  locationBias?: string | null;
  userCoords?: { latitude: number; longitude: number } | null;
  pageToken?: string | null;
  maxResultCount?: number;
};

const FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.photos,nextPageToken';

type PlacesTextSearchResponse = {
  places?: GooglePlaceJson[];
  nextPageToken?: string;
};

type GooglePlaceJson = {
  id?: string;
  name?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  googleMapsUri?: string;
  photos?: { name?: string }[];
};

function buildPhotoMediaUrl(photoResourceName: string, apiKey: string): string {
  const mediaBase = `https://places.googleapis.com/v1/${photoResourceName}/media`;
  const params = new URLSearchParams({
    maxHeightPx: '512',
    maxWidthPx: '512',
    key: apiKey,
  });
  return wrapGooglePlacesHttpsForWebFetch(`${mediaBase}?${params.toString()}`);
}

function formatCategory(types: string[] | undefined): string {
  if (!types?.length) return '';
  return types
    .slice(0, 3)
    .map((t) => t.replace(/_/g, ' '))
    .join(' › ');
}

function parsePlaceRow(p: GooglePlaceJson, apiKey: string, index: number): PlaceSearchRow | null {
  const pid = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : '';
  const title =
    typeof p.displayName?.text === 'string'
      ? p.displayName.text.trim()
      : typeof p.name === 'string'
        ? p.name.replace(/^places\//, '').trim()
        : '';
  const formatted = typeof p.formattedAddress === 'string' ? p.formattedAddress.trim() : '';
  if (!title && !formatted) return null;

  const lat = typeof p.location?.latitude === 'number' ? p.location.latitude : null;
  const lng = typeof p.location?.longitude === 'number' ? p.location.longitude : null;

  const link = typeof p.googleMapsUri === 'string' && p.googleMapsUri.startsWith('http') ? p.googleMapsUri.trim() : undefined;

  const photoName = p.photos?.[0]?.name?.trim();
  let thumbnailUrl: string | null = null;
  if (photoName && apiKey) {
    const u = buildPhotoMediaUrl(photoName, apiKey);
    if (u.startsWith('https://')) thumbnailUrl = u;
  }

  const id = pid ? `gplace-${pid}` : `gplace-idx-${index}-${title.slice(0, 12)}`;

  return {
    id,
    title: title || formatted,
    address: formatted,
    roadAddress: formatted,
    category: formatCategory(p.types),
    ...(link ? { link } : {}),
    latitude: lat,
    longitude: lng,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };
}

/**
 * Places API(New) Text Search — 장소 제안·후보 목록.
 * @see https://developers.google.com/maps/documentation/places/web-service/text-search
 */
export async function searchPlacesText(
  query: string,
  options?: SearchPlacesTextOptions,
): Promise<{ places: PlaceSearchRow[]; nextPageToken: string | null }> {
  const apiKey = resolveGooglePlacesRestApiKey();
  if (!apiKey) {
    throw new Error(
      'Google Places API 키가 없습니다. env에 EXPO_PUBLIC_GOOGLE_PLACES_API_KEY 또는 EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY를 설정하고 Metro를 재시작하세요.',
    );
  }

  let textQuery = query.trim();
  const bias = options?.locationBias?.trim();
  const coords = options?.userCoords;
  if (bias && !coords && textQuery && !textQuery.includes(bias)) {
    textQuery = `${textQuery} ${bias}`.replace(/\s+/g, ' ').trim();
  }
  if (!textQuery) return { places: [], nextPageToken: null };

  const maxResultCount = Math.min(
    20,
    Math.max(1, Math.floor(options?.maxResultCount ?? 10)),
  );

  const body: Record<string, unknown> = {
    textQuery,
    languageCode: 'ko',
    regionCode: 'kr',
    maxResultCount,
  };

  if (coords && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)) {
    body.locationBias = {
      circle: {
        center: { latitude: coords.latitude, longitude: coords.longitude },
        radius: 25000,
      },
    };
  }

  const pageToken = options?.pageToken?.trim();
  if (pageToken) {
    body.pageToken = pageToken;
  }

  const endpoint = wrapGooglePlacesHttpsForWebFetch('https://places.googleapis.com/v1/places:searchText');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google 장소 검색 오류 (${res.status}): ${t.slice(0, 200)}`);
  }

  const json = (await res.json()) as PlacesTextSearchResponse;
  const raw = json.places ?? [];
  const places: PlaceSearchRow[] = [];
  raw.forEach((p, idx) => {
    const row = parsePlaceRow(p, apiKey, idx);
    if (row) places.push(row);
  });

  const next = typeof json.nextPageToken === 'string' && json.nextPageToken.trim() ? json.nextPageToken.trim() : null;

  return { places, nextPageToken: next };
}

/** 좌표가 이미 있으면 그대로 반환(Text Search가 채움). */
export async function resolvePlaceSearchRowCoordinates(row: PlaceSearchRow): Promise<PlaceSearchRow> {
  if (row.latitude != null && row.longitude != null) return row;
  throw new Error('장소 좌표를 불러오지 못했습니다. 다시 검색해 주세요.');
}
