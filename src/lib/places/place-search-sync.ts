import {
  searchPlacesByKeyword,
  syncSearchPlaceMasters,
  type PlaceMasterSummary,
} from '@/src/lib/places/place-master-api';
import {
  derivePlaceKeyFromSearchRow,
  placeSearchRowHybridMergeKey,
} from '@/src/lib/places/place-key';
import {
  placeMasterToSearchRow,
  searchPlacesCacheLocal,
  upsertPlacesCacheBatch,
} from '@/src/lib/places/places-cache-local';
import { mergeCachedThumbnailsIntoRows } from '@/src/lib/place-thumbnail-cache';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

const sessionSyncedPlaceKeys = new Set<string>();

export function resetPlaceSearchSyncSession(): void {
  sessionSyncedPlaceKeys.clear();
}

function rowPlaceKeyForSync(row: PlaceSearchRow): string | null {
  if (row.id.startsWith('sponsored:')) return null;
  return derivePlaceKeyFromSearchRow({
    title: row.title,
    link: row.link,
    roadAddress: row.roadAddress,
    address: row.address,
  });
}

function filterRowsForSync(rows: readonly PlaceSearchRow[]): PlaceSearchRow[] {
  return rows.filter((row) => {
    const key = rowPlaceKeyForSync(row);
    if (!key) return true;
    if (sessionSyncedPlaceKeys.has(key)) return false;
    return true;
  });
}

/** 네이버 검색 결과 — 서버 places 적재 + WM 캐시 (UI 비블로킹) */
export async function syncSearchRowsToPlaceMaster(
  rows: readonly PlaceSearchRow[],
): Promise<Map<string, PlaceMasterSummary>> {
  const toSync = filterRowsForSync(rows);
  if (toSync.length === 0) return new Map();

  const result = await syncSearchPlaceMasters(toSync);
  for (const key of result.places.keys()) {
    sessionSyncedPlaceKeys.add(key);
  }
  void upsertPlacesCacheBatch([...result.places.values()]);
  return result.places;
}

export function scheduleSyncSearchRowsToPlaceMaster(rows: readonly PlaceSearchRow[]): void {
  if (rows.length === 0) return;
  void syncSearchRowsToPlaceMaster(rows).catch((e) => {
    if (__DEV__) console.warn('[scheduleSyncSearchRowsToPlaceMaster]', e);
  });
}

/** 로컬 WM + 지닛 DB 키워드 검색 → PlaceSearchRow (네이버 검색 전 병합용) */
export async function fetchHybridPlaceSearchPrefill(
  query: string,
  opts?: { localLimit?: number; keywordLimit?: number },
): Promise<PlaceSearchRow[]> {
  const q = query.trim();
  if (!q) return [];

  const localLimit = opts?.localLimit ?? 8;
  const keywordLimit = opts?.keywordLimit ?? 5;

  const [localHits, keywordHits] = await Promise.all([
    searchPlacesCacheLocal(q, localLimit),
    searchPlacesByKeyword(q, { limit: keywordLimit, includeUnreviewed: true }),
  ]);

  const seen = new Set<string>();
  const out: PlaceSearchRow[] = [];

  const append = (summary: PlaceMasterSummary) => {
    const row = placeMasterToSearchRow(summary);
    const key = placeSearchRowHybridMergeKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  for (const s of localHits) append(s);
  for (const s of keywordHits) append(s);

  return mergeCachedThumbnailsIntoRows(out);
}

function isUsableRemoteImageUrl(raw: string | null | undefined): raw is string {
  const t = raw?.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function mergePlaceSearchRowFields(existing: PlaceSearchRow, incoming: PlaceSearchRow): PlaceSearchRow {
  const thumb =
    isUsableRemoteImageUrl(existing.thumbnailUrl) && !isUsableRemoteImageUrl(incoming.thumbnailUrl)
      ? existing.thumbnailUrl
      : incoming.thumbnailUrl ?? existing.thumbnailUrl;
  const link = incoming.link?.trim() || existing.link;
  return {
    ...incoming,
    link: link || undefined,
    thumbnailUrl: thumb ?? null,
    isSponsoredPromotion: existing.isSponsoredPromotion || incoming.isSponsoredPromotion,
    promotionId: existing.promotionId ?? incoming.promotionId,
  };
}

export function mergeHybridPrefillWithNaverRows(
  prefill: readonly PlaceSearchRow[],
  naverRows: readonly PlaceSearchRow[],
  sponsoredRows: readonly PlaceSearchRow[],
): PlaceSearchRow[] {
  const seen = new Set<string>();
  const out: PlaceSearchRow[] = [];

  const appendOrMerge = (row: PlaceSearchRow) => {
    const key = placeSearchRowHybridMergeKey(row);
    const idx = out.findIndex((r) => placeSearchRowHybridMergeKey(r) === key);
    if (idx >= 0) {
      out[idx] = mergePlaceSearchRowFields(out[idx]!, row);
      return;
    }
    seen.add(key);
    out.push(row);
  };

  for (const row of sponsoredRows) appendOrMerge(row);
  for (const row of prefill) appendOrMerge(row);
  for (const row of naverRows) appendOrMerge(row);

  return mergeCachedThumbnailsIntoRows(out);
}
