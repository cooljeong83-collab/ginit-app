import AsyncStorage from '@react-native-async-storage/async-storage';

import { derivePlaceKeyFromSearchRow } from '@/src/lib/places/place-key';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

const STORAGE_PREFIX = 'ginit_place_thumb_v1:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

type ThumbCacheEntry = {
  url: string | null;
  cachedAt: number;
};

export type CachedPlaceThumbnailResult =
  | { hit: false }
  | { hit: true; url: string | null };

const memoryL1 = new Map<string, ThumbCacheEntry>();

function normalizePlaceKey(placeKey: string): string {
  return placeKey.trim();
}

function storageKey(placeKey: string): string {
  return `${STORAGE_PREFIX}${normalizePlaceKey(placeKey)}`;
}

function isFresh(entry: ThumbCacheEntry): boolean {
  return Date.now() - entry.cachedAt < TTL_MS;
}

function parseEntry(raw: string | null): ThumbCacheEntry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as ThumbCacheEntry;
    if (typeof o.cachedAt !== 'number' || !Number.isFinite(o.cachedAt)) return null;
    const url = o.url;
    if (url != null && typeof url !== 'string') return null;
    return { url: url?.trim() ? url.trim() : null, cachedAt: o.cachedAt };
  } catch {
    return null;
  }
}

async function touchL2Index(placeKey: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}__index`);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const key = normalizePlaceKey(placeKey);
    const next = [key, ...list.filter((k) => k !== key)].slice(0, MAX_ENTRIES);
    if (next.length >= MAX_ENTRIES) {
      const dropped = list.filter((k) => !next.includes(k));
      await Promise.all(dropped.map((k) => AsyncStorage.removeItem(storageKey(k))));
    }
    await AsyncStorage.setItem(`${STORAGE_PREFIX}__index`, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function getCachedPlaceThumbnail(placeKey: string): Promise<CachedPlaceThumbnailResult> {
  const key = normalizePlaceKey(placeKey);
  if (!key) return { hit: false };

  const mem = memoryL1.get(key);
  if (mem && isFresh(mem)) {
    return { hit: true, url: mem.url };
  }

  try {
    const parsed = parseEntry(await AsyncStorage.getItem(storageKey(key)));
    if (parsed && isFresh(parsed)) {
      memoryL1.set(key, parsed);
      return { hit: true, url: parsed.url };
    }
    if (parsed && !isFresh(parsed)) {
      memoryL1.delete(key);
      void AsyncStorage.removeItem(storageKey(key));
    }
  } catch {
    /* ignore */
  }

  return { hit: false };
}

export async function setCachedPlaceThumbnail(placeKey: string, url: string | null): Promise<void> {
  const key = normalizePlaceKey(placeKey);
  if (!key) return;

  const entry: ThumbCacheEntry = { url, cachedAt: Date.now() };
  memoryL1.set(key, entry);

  try {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(entry));
    await touchL2Index(key);
  } catch {
    /* ignore */
  }
}

export function mergeCachedThumbnailsIntoRows(rows: readonly PlaceSearchRow[]): PlaceSearchRow[] {
  return rows.map((row) => {
    if ((row.thumbnailUrl ?? '').trim().startsWith('https://')) return row;
    const pk = derivePlaceKeyFromSearchRow(row);
    const mem = memoryL1.get(pk);
    if (mem && isFresh(mem) && mem.url) {
      return { ...row, thumbnailUrl: mem.url };
    }
    return row;
  });
}

/** L2에서 일괄 병합(검색 캐시 hit 시) */
export async function hydrateRowsThumbnailsFromCache(
  rows: readonly PlaceSearchRow[],
): Promise<PlaceSearchRow[]> {
  const out: PlaceSearchRow[] = [];
  for (const row of rows) {
    if ((row.thumbnailUrl ?? '').trim().startsWith('https://')) {
      out.push(row);
      continue;
    }
    const pk = derivePlaceKeyFromSearchRow(row);
    const cached = await getCachedPlaceThumbnail(pk);
    if (cached.hit && cached.url) {
      out.push({ ...row, thumbnailUrl: cached.url });
      continue;
    }
    out.push(row);
  }
  return out;
}

export async function persistPlaceThumbnailsFromSearchRows(rows: readonly PlaceSearchRow[]): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      const pk = derivePlaceKeyFromSearchRow(row);
      const url = (row.thumbnailUrl ?? '').trim();
      if (url.startsWith('https://')) {
        await setCachedPlaceThumbnail(pk, url);
        return;
      }
    }),
  );
}
