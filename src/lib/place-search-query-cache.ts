import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  hydrateRowsThumbnailsFromCache,
  persistPlaceThumbnailsFromSearchRows,
} from '@/src/lib/place-thumbnail-cache';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

const STORAGE_PREFIX = 'ginit_place_search_v1:';
const INDEX_KEY = `${STORAGE_PREFIX}__index`;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50;
/** Android 스크랩 세션 전체 행 — AsyncStorage 부담 상한 */
export const MAX_SCRAPE_SESSION_ROWS = 100;

export type PlaceSearchScrapeSession = {
  norm: string;
  rows: PlaceSearchRow[];
};

export type CachedPlaceSearchPage = {
  places: PlaceSearchRow[];
  nextPageToken: string | null;
  cachedAt: number;
  /** Android `sb:` 가상 페이지네이션 복원용 */
  scrapeSessionNorm?: string;
  scrapeSessionRows?: PlaceSearchRow[];
};

export type SetCachedPlaceSearchPagePayload = {
  places: PlaceSearchRow[];
  nextPageToken: string | null;
  scrapeSession?: PlaceSearchScrapeSession | null;
};

type IndexEntry = {
  key: string;
  cachedAt: number;
};

function normalizePart(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function capScrapeSessionRows(rows: PlaceSearchRow[]): PlaceSearchRow[] {
  if (rows.length <= MAX_SCRAPE_SESSION_ROWS) return rows;
  return rows.slice(0, MAX_SCRAPE_SESSION_ROWS);
}

/** OpenAPI 페이지 번호 또는 Android `sb:`/`s:` 가상 토큰 */
export function buildPlaceSearchQueryCacheKey(
  query: string,
  locationBias: string | null | undefined,
  pageToken: string | null | undefined,
): string {
  const q = normalizePart(query);
  const b = normalizePart(locationBias);
  const p = (pageToken ?? '').trim() || '1';
  return `${q}|${b}|${p}`;
}

function storageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${cacheKey}`;
}

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < TTL_MS;
}

async function readIndex(): Promise<IndexEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IndexEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.key === 'string' && typeof e.cachedAt === 'number');
  } catch {
    return [];
  }
}

async function writeIndex(entries: IndexEntry[]): Promise<void> {
  try {
    const trimmed = entries.slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

async function touchIndex(cacheKey: string, cachedAt: number): Promise<void> {
  const list = await readIndex();
  const next = [{ key: cacheKey, cachedAt }, ...list.filter((e) => e.key !== cacheKey)];
  if (next.length > MAX_ENTRIES) {
    const keep = new Set(next.slice(0, MAX_ENTRIES).map((e) => e.key));
    const drop = list.filter((e) => !keep.has(e.key));
    await Promise.all(drop.map((e) => AsyncStorage.removeItem(storageKey(e.key))));
  }
  await writeIndex(next.slice(0, MAX_ENTRIES));
}

export async function getCachedPlaceSearchPage(
  cacheKey: string,
): Promise<CachedPlaceSearchPage | null> {
  const key = cacheKey.trim();
  if (!key) return null;

  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPlaceSearchPage;
    if (!parsed || typeof parsed.cachedAt !== 'number' || !Array.isArray(parsed.places)) {
      return null;
    }
    if (!isFresh(parsed.cachedAt)) {
      void AsyncStorage.removeItem(storageKey(key));
      return null;
    }
    const places = await hydrateRowsThumbnailsFromCache(parsed.places);
    const sessionNorm =
      typeof parsed.scrapeSessionNorm === 'string' && parsed.scrapeSessionNorm.trim()
        ? parsed.scrapeSessionNorm.trim()
        : undefined;
    const sessionRowsRaw = Array.isArray(parsed.scrapeSessionRows) ? parsed.scrapeSessionRows : [];
    const scrapeSessionRows =
      sessionRowsRaw.length > 0
        ? await hydrateRowsThumbnailsFromCache(capScrapeSessionRows(sessionRowsRaw))
        : undefined;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[PlaceSearchQueryCache]', {
        event: 'hit',
        key,
        count: places.length,
        sessionRows: scrapeSessionRows?.length ?? 0,
      });
    }
    return {
      places,
      nextPageToken:
        typeof parsed.nextPageToken === 'string' && parsed.nextPageToken.trim()
          ? parsed.nextPageToken.trim()
          : null,
      cachedAt: parsed.cachedAt,
      scrapeSessionNorm: sessionNorm,
      scrapeSessionRows,
    };
  } catch {
    return null;
  }
}

export async function setCachedPlaceSearchPage(
  cacheKey: string,
  payload: SetCachedPlaceSearchPagePayload,
): Promise<void> {
  const key = cacheKey.trim();
  if (!key) return;

  const cachedAt = Date.now();
  const session = payload.scrapeSession;
  const sessionNorm = session?.norm?.trim() || undefined;
  const sessionRows =
    session?.rows && session.rows.length > 0 ? capScrapeSessionRows(session.rows) : undefined;

  const entry: CachedPlaceSearchPage = {
    places: payload.places,
    nextPageToken: payload.nextPageToken,
    cachedAt,
    ...(sessionNorm && sessionRows?.length
      ? { scrapeSessionNorm: sessionNorm, scrapeSessionRows: sessionRows }
      : {}),
  };

  try {
    await AsyncStorage.setItem(storageKey(key), JSON.stringify(entry));
    await touchIndex(key, cachedAt);
    await persistPlaceThumbnailsFromSearchRows(payload.places);
    if (sessionRows?.length) {
      await persistPlaceThumbnailsFromSearchRows(sessionRows);
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[PlaceSearchQueryCache]', {
        event: 'set',
        key,
        count: payload.places.length,
        sessionRows: sessionRows?.length ?? 0,
      });
    }
  } catch {
    /* ignore */
  }
}
