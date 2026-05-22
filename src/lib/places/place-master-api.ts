import {
  buildPlaceSearchSyncPayloads,
  type PlaceSearchSyncPayloadRow,
} from '@/src/lib/places/place-search-sync-payload';
import { buildPlaceLookupKeys, pickBestPlaceMaster } from '@/src/lib/places/place-lookup-keys';
import type { PlaceLookupInput } from '@/src/lib/places/place-lookup-keys';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';
import { supabase } from '@/src/lib/supabase';

export type PlaceKeywordStat = {
  keyword: string;
  count: number;
};

export type PlaceMasterSummary = {
  placeKey: string;
  id: string;
  placeName: string;
  averageRating: number;
  reviewCount: number;
  topKeywords: PlaceKeywordStat[];
  category: string | null;
  roadAddress: string;
  preferredPhotoMediaUrl: string | null;
  naverPlaceLink: string | null;
  latitude: number | null;
  longitude: number | null;
};

function parseTopKeywords(raw: unknown): PlaceKeywordStat[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceKeywordStat[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const keyword = typeof o.keyword === 'string' ? o.keyword.trim() : '';
    const count = typeof o.count === 'number' ? o.count : Number(o.count);
    if (!keyword || !Number.isFinite(count) || count < 1) continue;
    out.push({ keyword, count });
  }
  return out;
}

export type PlaceReviewTimelineItem = {
  id: string;
  rating: number;
  selectedKeywords: string[];
  comment: string | null;
  createdAt: string;
  displayName: string;
  avatarUrl: string | null;
  appUserId: string;
};

function parsePlaceRow(raw: unknown): PlaceMasterSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const placeKey = typeof o.place_key === 'string' ? o.place_key.trim() : '';
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!placeKey || !id) return null;
  const avg =
    typeof o.average_rating === 'number' ? o.average_rating : Number(o.average_rating) || 0;
  const cnt =
    typeof o.review_count === 'number' ? o.review_count : Number(o.review_count) || 0;
  return {
    placeKey,
    id,
    placeName: typeof o.place_name === 'string' ? o.place_name : '',
    averageRating: avg,
    reviewCount: cnt,
    topKeywords: parseTopKeywords(o.top_keywords),
    category: typeof o.category === 'string' && o.category.trim() ? o.category.trim() : null,
    roadAddress: typeof o.road_address === 'string' ? o.road_address : '',
    preferredPhotoMediaUrl:
      typeof o.preferred_photo_media_url === 'string' && o.preferred_photo_media_url.trim()
        ? o.preferred_photo_media_url.trim()
        : null,
    naverPlaceLink:
      typeof o.naver_place_link === 'string' && o.naver_place_link.trim()
        ? o.naver_place_link.trim()
        : null,
    latitude:
      o.latitude != null && Number.isFinite(Number(o.latitude)) ? Number(o.latitude) : null,
    longitude:
      o.longitude != null && Number.isFinite(Number(o.longitude)) ? Number(o.longitude) : null,
  };
}

function parseTimelineItem(raw: unknown): PlaceReviewTimelineItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  if (!id) return null;
  const rating = typeof o.rating === 'number' ? o.rating : Number(o.rating);
  if (!Number.isFinite(rating)) return null;
  const kwRaw = Array.isArray(o.selected_keywords) ? o.selected_keywords : [];
  return {
    id,
    rating,
    selectedKeywords: kwRaw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0),
    comment:
      typeof o.comment === 'string' && o.comment.trim() ? o.comment.trim() : null,
    createdAt: typeof o.created_at === 'string' ? o.created_at : '',
    displayName: typeof o.display_name === 'string' ? o.display_name : '회원',
    avatarUrl:
      typeof o.avatar_url === 'string' && o.avatar_url.trim() ? o.avatar_url.trim() : null,
    appUserId: typeof o.app_user_id === 'string' ? o.app_user_id : '',
  };
}

function parsePlacesMapFromRpcRows(rows: unknown[]): Map<string, PlaceMasterSummary> {
  const out = new Map<string, PlaceMasterSummary>();
  for (const raw of rows) {
    const row = parsePlaceRow(raw);
    if (row) out.set(row.placeKey, row);
  }
  return out;
}

export type SyncSearchPlaceMastersResult = {
  places: Map<string, PlaceMasterSummary>;
  insertedCount: number;
  updatedCount: number;
};

/** 검색 결과 배치 적재 + 동일 키로 places 조회 (1 RPC) */
export async function syncSearchPlaceMasters(
  rows: readonly PlaceSearchRow[] | readonly PlaceSearchSyncPayloadRow[],
): Promise<SyncSearchPlaceMastersResult> {
  const payloads: PlaceSearchSyncPayloadRow[] =
    rows.length > 0 && rows[0] && 'place_key' in rows[0]
      ? (rows as PlaceSearchSyncPayloadRow[])
      : buildPlaceSearchSyncPayloads(rows as PlaceSearchRow[]);

  const empty = { places: new Map<string, PlaceMasterSummary>(), insertedCount: 0, updatedCount: 0 };
  if (payloads.length === 0) return empty;

  const { data, error } = await supabase.rpc('sync_search_place_masters', {
    p_rows: payloads,
  });
  if (error) {
    if (__DEV__) console.warn('[syncSearchPlaceMasters]', error.message);
    return empty;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;

  const o = data as Record<string, unknown>;
  const placesRaw = Array.isArray(o.places) ? o.places : [];
  const insertedCount =
    typeof o.inserted_count === 'number' ? o.inserted_count : Number(o.inserted_count) || 0;
  const updatedCount =
    typeof o.updated_count === 'number' ? o.updated_count : Number(o.updated_count) || 0;

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[syncSearchPlaceMasters]', {
      payloads: payloads.length,
      insertedCount,
      updatedCount,
      returned: placesRaw.length,
    });
  }

  return {
    places: parsePlacesMapFromRpcRows(placesRaw),
    insertedCount,
    updatedCount,
  };
}

export async function fetchPlacesByKeys(
  placeKeys: string[],
  opts?: { placeName?: string; roadAddress?: string },
): Promise<Map<string, PlaceMasterSummary>> {
  const keys = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))];
  const out = new Map<string, PlaceMasterSummary>();
  if (keys.length === 0) return out;

  const { data, error } = await supabase.rpc('get_places_by_keys', {
    p_place_keys: keys,
    p_place_name: opts?.placeName?.trim() ? opts.placeName.trim() : null,
    p_road_address: opts?.roadAddress?.trim() ? opts.roadAddress.trim() : null,
  });
  if (error) {
    if (__DEV__) console.warn('[fetchPlacesByKeys]', error.message);
    return out;
  }

  const rows = Array.isArray(data) ? data : [];
  return parsePlacesMapFromRpcRows(rows);
}

export async function fetchPlaceMasterByLookup(
  input: PlaceLookupInput,
): Promise<PlaceMasterSummary | null> {
  const keys = buildPlaceLookupKeys(input);
  if (keys.length === 0) return null;
  const map = await fetchPlacesByKeys(keys, {
    placeName: input.placeName,
    roadAddress: input.roadAddress,
  });
  return pickBestPlaceMaster(map.values());
}

export async function fetchPlaceReviewsByPlaceKey(
  placeKey: string,
  opts?: {
    limit?: number;
    cursor?: string | null;
    lookupKeys?: string[];
    placeName?: string;
    roadAddress?: string;
  },
): Promise<{ items: PlaceReviewTimelineItem[]; nextCursor: string | null }> {
  const key = placeKey.trim();
  if (!key) return { items: [], nextCursor: null };

  const altKeys = [...new Set((opts?.lookupKeys ?? []).map((k) => k.trim()).filter(Boolean))].filter(
    (k) => k !== key,
  );

  const { data, error } = await supabase.rpc('list_place_reviews_by_place_key', {
    p_place_key: key,
    p_limit: opts?.limit ?? 20,
    p_cursor: opts?.cursor ?? null,
    p_lookup_keys: altKeys.length > 0 ? altKeys : null,
    p_place_name: opts?.placeName?.trim() ? opts.placeName.trim() : null,
    p_road_address: opts?.roadAddress?.trim() ? opts.roadAddress.trim() : null,
  });
  if (error) {
    if (__DEV__) console.warn('[fetchPlaceReviewsByPlaceKey]', error.message);
    return { items: [], nextCursor: null };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { items: [], nextCursor: null };
  }
  const o = data as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items = itemsRaw
    .map(parseTimelineItem)
    .filter((x): x is PlaceReviewTimelineItem => x != null);
  const nextCursor =
    typeof o.next_cursor === 'string' && o.next_cursor.trim() ? o.next_cursor.trim() : null;
  return { items, nextCursor };
}

export async function searchPlacesByKeyword(
  query: string,
  opts?: { limit?: number; includeUnreviewed?: boolean },
): Promise<PlaceMasterSummary[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc('search_places_by_keyword', {
    p_query: q,
    p_limit: opts?.limit ?? 30,
    p_include_unreviewed: opts?.includeUnreviewed ?? true,
  });
  if (error || !Array.isArray(data)) return [];

  return data
    .map(parsePlaceRow)
    .filter((x): x is PlaceMasterSummary => x != null);
}
