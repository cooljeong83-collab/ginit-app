import { Q } from '@nozbe/watermelondb';

import type { PlaceMasterSummary } from '@/src/lib/places/place-master-api';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import { database } from '@/src/watermelon/database';
import { PlaceCache } from '@/src/watermelon/models/PlaceCache';

const MAX_PLACES_CACHE_ROWS = 2000;
const PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function placeMasterToSearchRow(summary: PlaceMasterSummary): PlaceSearchRow {
  const link = sanitizeNaverLocalPlaceLink(summary.naverPlaceLink ?? undefined);
  return {
    id: `place-cache:${summary.placeKey}`,
    title: summary.placeName,
    address: summary.roadAddress,
    roadAddress: summary.roadAddress,
    category: summary.category ?? '',
    link: link ?? undefined,
    latitude: summary.latitude,
    longitude: summary.longitude,
    thumbnailUrl: summary.preferredPhotoMediaUrl,
  };
}

export async function searchPlacesCacheLocal(
  query: string,
  limit = 10,
): Promise<PlaceMasterSummary[]> {
  const db = database;
  const q = query.trim().toLowerCase();
  if (!db || !q) return [];

  try {
    const pattern = `%${q}%`;
    const rows = await db
      .get<PlaceCache>('places_cache')
      .query(
        Q.or(
          Q.where('place_name', Q.like(pattern)),
          Q.where('road_address', Q.like(pattern)),
          Q.where('place_key', Q.like(pattern)),
        ),
        Q.sortBy('synced_at_ms', Q.desc),
        Q.take(limit),
      )
      .fetch();

    return rows.map((r) => r.toSummary());
  } catch (e) {
    if (__DEV__) console.warn('[searchPlacesCacheLocal]', e);
    return [];
  }
}

export async function upsertPlacesCacheBatch(summaries: readonly PlaceMasterSummary[]): Promise<void> {
  const db = database;
  if (!db || summaries.length === 0) return;

  const now = Date.now();
  try {
    await db.write(async () => {
      const coll = db.get<PlaceCache>('places_cache');
      for (const s of summaries) {
        const key = s.placeKey.trim();
        if (!key) continue;
        const existing = await coll.query(Q.where('place_key', key), Q.take(1)).fetch();
        if (existing[0]) {
          await existing[0].updateFromSummary(s, now);
        } else {
          await coll.create((rec) => {
            rec.placeKey = key;
            rec.updateFromSummary(s, now);
          });
        }
      }
    });

    await prunePlacesCacheIfNeeded();
  } catch (e) {
    if (__DEV__) console.warn('[upsertPlacesCacheBatch]', e);
  }
}

async function prunePlacesCacheIfNeeded(): Promise<void> {
  const db = database;
  if (!db) return;

  const total = await db.get<PlaceCache>('places_cache').query().fetchCount();
  if (total <= MAX_PLACES_CACHE_ROWS) return;

  const cutoff = Date.now() - PRUNE_AGE_MS;
  const excess = total - MAX_PLACES_CACHE_ROWS;
  const stale = await db
    .get<PlaceCache>('places_cache')
    .query(Q.where('synced_at_ms', Q.lt(cutoff)), Q.sortBy('synced_at_ms', Q.asc), Q.take(excess))
    .fetch();

  if (stale.length === 0) return;

  await db.write(async () => {
    for (const row of stale) {
      await row.markAsDeleted();
      await row.destroyPermanently();
    }
  });
}
