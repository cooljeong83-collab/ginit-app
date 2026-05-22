/**
 * 네이버 Open API **지역 검색(local.json)** 전용 — Google Places API 미사용.
 * Android 1페이지는 `ScrapingPlaceSearchService`(Jsoup·모바일 웹) 우선, 실패·빈 결과 시 Open API 폴백.
 */
import { Platform } from 'react-native';

import type { NaverLocalPlace } from '@/src/lib/naver-local-search';
import {
  resolveNaverPlaceCoordinates,
  searchNaverLocalKeywordPlacesPaginated,
} from '@/src/lib/naver-local-search';
import { getInterestRegionDisplayLabel } from '@/src/lib/korea-interest-districts';
import {
  buildPlaceSearchQueryCacheKey,
  getCachedPlaceSearchPage,
  type PlaceSearchScrapeSession,
  setCachedPlaceSearchPage,
} from '@/src/lib/place-search-query-cache';
import {
  mergeCachedThumbnailsIntoRows,
  persistPlaceThumbnailsFromSearchRows,
} from '@/src/lib/place-thumbnail-cache';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';
import { ScrapingBusinessSearchService } from '@/src/lib/scraping-business-search-service';

export { stableNaverLocalSearchDedupeKey } from '@/src/lib/naver-local-search';

/**
 * 네이버 지역 검색 응답을 모임 생성 등에서 쓰는 `PlaceSearchRow` 스키마로 유지.
 * @see https://developers.naver.com/docs/serviceapi/search/local/local.md
 */
export type { PlaceSearchRow } from '@/src/lib/place-search-row';

export type SearchPlacesTextOptions = {
  /** 쿼리 끝에 붙는 지역 힌트(구·동 등) */
  locationBias?: string | null;
  userCoords?: { latitude: number; longitude: number } | null;
  /**
   * 다음 페이지 토큰.
   * - OpenAPI: `"2"`, `"3"` …
   * - Android 모바일 스크랩 세션: 같은 검색으로 이어 받기 `"s:5"`, `"s:10"` …(내부 버퍼 오프셋)
   */
  pageToken?: string | null;
  /** `pageToken`이 2 이상일 때 — 이미 목록에 있는 장소 제외(`stableNaverLocalSearchDedupeKey`) */
  excludeStablePlaceKeys?: readonly string[] | null;
  maxResultCount?: number;
  /**
   * 네이버 지역 검색은 OpenAPI에서 정렬 고정(`sort=comment`).
   * 호환용으로만 남김 — 값은 무시됩니다.
   */
  sort?: 'accuracy' | 'distance';
};

function parseNumericPageToken(pageToken: string | null | undefined): number {
  const raw = (pageToken ?? '').trim();
  if (!raw) return 1;
  if (!/^\d+$/.test(raw)) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  /** 가상 페이지 상한 — `searchNaverLocalKeywordPlacesPaginated`의 CAP과 맞춤 */
  return Math.min(200, n);
}

/** Android 스크랩 1회 결과를 무한 스크롤 청크로 자릅기 위한 세션 버퍼 */
let scrapeInfiniteBuffer: { norm: string; rows: PlaceSearchRow[] } | null = null;
let scrapeBusinessInfiniteBuffer: { norm: string; rows: PlaceSearchRow[] } | null = null;

function scrapeQueryNormForBuffer(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

function buildBizScrapeQuery(textQuery: string, locationBias: string | null | undefined): string {
  const q0 = textQuery.trim().replace(/\s+/g, ' ').trim();
  const b = (locationBias ?? '').trim().replace(/\s+/g, ' ').trim();
  if (!q0) return q0;
  if (!b) return q0;

  // 관심지역이 "영등포구"처럼 구 단위만 있어도, 전국 표준 라벨(서울특별시 영등포구 등)로 확장합니다.
  const bDisplay = getInterestRegionDisplayLabel(b).trim();
  const bFinal = bDisplay || b;

  // 검색어 안에 지역명이 이미 들어있으면 제거한 뒤(중복 방지), 관심지역을 1회만 붙입니다.
  // 예: 관심지역=영등포구, query="영등포 스크린골프" → "서울특별시 영등포구 스크린골프"
  const variants = (() => {
    const out = new Set<string>();
    const add = (s: string) => {
      const t = s.replace(/\s+/g, ' ').trim();
      if (!t) return;
      out.add(t);
    };
    add(bFinal);
    add(b);
    // 도시 토큰(서울/대전 등)도 중복 제거 대상으로 포함
    const firstToken = bFinal.split(/\s+/).filter(Boolean)[0] ?? '';
    const cityShort = firstToken.replace(/특별시|광역시|특별자치시|특별자치도/g, '').replace(/도$/g, '').replace(/시$/g, '').trim();
    add(firstToken);
    add(cityShort);
    // "…구" 형태면 "…"(구 제거)도 같이 제거(예: "영등포구" → "영등포")
    const noGu = b.replace(/[구]$/u, '').trim();
    if (noGu && noGu !== b) add(noGu);
    return Array.from(out).filter(Boolean);
  })();

  let q = q0;
  for (const v of variants) {
    // 단어 경계가 애매한 한글 특성을 감안해 공백/문장 경계 기준으로 반복 제거
    const re = new RegExp(`(^|\\s)${v.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(\\s|$)`, 'gu');
    for (let i = 0; i < 4; i += 1) {
      const prev = q;
      q = q.replace(re, '$1$2').replace(/\s+/g, ' ').trim();
      if (q === prev) break;
    }
  }

  if (!q) q = q0; // 전부 제거돼 버리면 원문 유지
  return `${bFinal} ${q}`.replace(/\s+/g, ' ').trim();
}

/** 다음 청크 요청 토큰 `s:<offset>` (동일 검색어 세션 내에서만 유효) */
function encodeScrapeVirtualPageToken(offset: number): string {
  return `s:${offset}`;
}

function parseScrapeVirtualPageToken(token: string): number | null {
  const m = /^s:(\d+)$/.exec(token.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** business 스크랩 세션 토큰 `sb:<offset>` */
function encodeBusinessScrapeVirtualPageToken(offset: number): string {
  return `sb:${offset}`;
}

function parseBusinessScrapeVirtualPageToken(token: string): number | null {
  const m = /^sb:(\d+)$/.exec(token.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Android 상세 스크래핑은 목록 반환 후 백그라운드 — 체감 검색 속도 우선 */
function scheduleAndroidThumbnailEnrich(rows: PlaceSearchRow[]): void {
  if (rows.length === 0) return;
  void ScrapingBusinessSearchService.enrichRowsNeedingThumbnail(rows)
    .then(() => persistPlaceThumbnailsFromSearchRows(rows))
    .catch(() => {
      /* ignore */
    });
}

function applyScrapeSessionToBusinessBuffer(session: {
  scrapeSessionNorm?: string;
  scrapeSessionRows?: PlaceSearchRow[];
}): void {
  const norm = session.scrapeSessionNorm?.trim();
  const rows = session.scrapeSessionRows;
  if (norm && rows && rows.length > 0) {
    scrapeBusinessInfiniteBuffer = { norm, rows };
  }
}

function finalizeSearchResult(
  places: PlaceSearchRow[],
  nextPageToken: string | null,
  cacheKey: string,
  scrapeSession?: PlaceSearchScrapeSession | null,
): { places: PlaceSearchRow[]; nextPageToken: string | null } {
  const merged = mergeCachedThumbnailsIntoRows(places);
  void setCachedPlaceSearchPage(cacheKey, {
    places: merged,
    nextPageToken,
    scrapeSession: scrapeSession ?? undefined,
  });
  return { places: merged, nextPageToken };
}

function sliceBusinessScrapeChunk(
  buf: { norm: string; rows: PlaceSearchRow[] },
  virtOffBiz: number,
  pageSize: number,
  textQuery: string,
  bias: string | undefined,
  coords: SearchPlacesTextOptions['userCoords'],
  queryCacheKey: string,
): { places: PlaceSearchRow[]; nextPageToken: string | null } {
  const slice = buf.rows.slice(virtOffBiz, virtOffBiz + pageSize);
  scheduleAndroidThumbnailEnrich(slice);
  const nextOff = virtOffBiz + slice.length;
  const nextTok = nextOff < buf.rows.length ? encodeBusinessScrapeVirtualPageToken(nextOff) : null;
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[NaverMobileBusinessScrape]', {
      source: 'scrape_chunk',
      query: textQuery,
      offset: virtOffBiz,
      chunkCount: slice.length,
      totalParsed: buf.rows.length,
      nextPageToken: nextTok,
      locationBias: bias ?? null,
      userCoords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
    });
  }
  return finalizeSearchResult(slice, nextTok, queryCacheKey);
}

/** 캐시 히트·앱 재시작 후 `sb:` 더보기 — 1페이지 캐시·재스크랩으로 버퍼 복원 */
async function ensureBusinessScrapeBuffer(
  textQuery: string,
  bias: string | undefined,
  qNorm: string,
  pageSize: number,
): Promise<boolean> {
  const buf = scrapeBusinessInfiniteBuffer;
  if (buf && buf.norm === qNorm && buf.rows.length > 0) return true;

  const page1Key = buildPlaceSearchQueryCacheKey(textQuery, bias, '1');
  const page1Cached = await getCachedPlaceSearchPage(page1Key);
  if (page1Cached) {
    applyScrapeSessionToBusinessBuffer(page1Cached);
    if (scrapeBusinessInfiniteBuffer?.norm === qNorm && scrapeBusinessInfiniteBuffer.rows.length > 0) {
      return true;
    }
  }

  if (!ScrapingBusinessSearchService.isAvailable()) return false;

  const bizScrapeQuery = buildBizScrapeQuery(textQuery, bias);
  try {
    const scraped = await ScrapingBusinessSearchService.fetchMappedMobilePlacesNoDetail(bizScrapeQuery);
    if (!scraped || scraped.length === 0) {
      scrapeBusinessInfiniteBuffer = null;
      return false;
    }
    scrapeBusinessInfiniteBuffer = { norm: qNorm, rows: scraped };
    const slice = scraped.slice(0, pageSize);
    const nextTok = scraped.length > pageSize ? encodeBusinessScrapeVirtualPageToken(pageSize) : null;
    void setCachedPlaceSearchPage(page1Key, {
      places: page1Cached?.places?.length ? page1Cached.places : slice,
      nextPageToken: page1Cached?.nextPageToken ?? nextTok,
      scrapeSession: { norm: qNorm, rows: scraped },
    });
    return true;
  } catch {
    scrapeBusinessInfiniteBuffer = null;
    return false;
  }
}

async function openApiSearchChunk(
  textQuery: string,
  options: SearchPlacesTextOptions | undefined,
  virtOffBiz: number | null,
  pageSize: number,
  queryCacheKey: string,
): Promise<{ places: PlaceSearchRow[]; nextPageToken: string | null }> {
  let q = textQuery.trim();
  const bias = options?.locationBias?.trim();
  const coords = options?.userCoords;
  if (bias && !coords && q && !q.includes(bias)) {
    q = `${q} ${bias}`.replace(/\s+/g, ' ').trim();
  }

  const page =
    virtOffBiz != null && virtOffBiz > 0 ? Math.floor(virtOffBiz / pageSize) + 1 : parseNumericPageToken(options?.pageToken);
  const { places: naverPlaces, nextPageToken } = await searchNaverLocalKeywordPlacesPaginated(q, {
    locationBias: options?.locationBias,
    page,
    pageSize,
    excludeStablePlaceKeys: page >= 2 ? options?.excludeStablePlaceKeys : undefined,
  });

  const places = naverPlaces.map(naverLocalToPlaceSearchRow);
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[NaverLocalKeywordSearch]', {
      source: virtOffBiz != null ? 'openapi_scrape_fallback' : 'openapi',
      query: q,
      page,
      pageSize,
      count: places.length,
      nextPageToken,
    });
  }
  return finalizeSearchResult(places, nextPageToken, queryCacheKey);
}

function naverLocalToPlaceSearchRow(p: NaverLocalPlace): PlaceSearchRow {
  return {
    id: p.id,
    title: p.title,
    address: p.address,
    roadAddress: p.roadAddress,
    category: p.category,
    ...(p.link ? { link: p.link } : {}),
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

/**
 * 네이버 지역 검색(Open API) — 키: `EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID` / `EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET`.
 */
export async function searchPlacesText(
  query: string,
  options?: SearchPlacesTextOptions,
): Promise<{ places: PlaceSearchRow[]; nextPageToken: string | null }> {
  // 기본 쿼리: 사용자가 입력한 검색어 그대로.
  // Android 스크래핑(`ScrapingPlaceSearchService`)에서는 지역명(bias)을 붙이지 않습니다.
  let textQuery = query.trim();
  const bias = options?.locationBias?.trim();
  const coords = options?.userCoords;
  if (!textQuery) return { places: [], nextPageToken: null };

  const pageSize = Math.min(5, Math.max(1, Math.floor(options?.maxResultCount ?? 5)));
  const rawTok = (options?.pageToken ?? '').trim();
  const queryCacheKey = buildPlaceSearchQueryCacheKey(query, bias, rawTok || '1');
  const queryCached = await getCachedPlaceSearchPage(queryCacheKey);
  if (queryCached) {
    applyScrapeSessionToBusinessBuffer(queryCached);
    return { places: queryCached.places, nextPageToken: queryCached.nextPageToken };
  }

  // Android(비지니스 우선): 모든 카테고리에 대해 순서대로 시도합니다.
  // 1) ScrapingBusinessSearchService(m.map 스크랩) 2) OpenAPI(local.json)
  if (Platform.OS === 'android') {
    const virtOffBiz = parseBusinessScrapeVirtualPageToken(rawTok);
    const bizScrapeQuery = buildBizScrapeQuery(textQuery, bias);
    const qNorm = scrapeQueryNormForBuffer(bizScrapeQuery);

    if (virtOffBiz != null) {
      let buf = scrapeBusinessInfiniteBuffer;
      if (!buf || buf.norm !== qNorm) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[NaverMobileBusinessScrape]', {
            source: 'scrape_buffer_miss',
            query: textQuery,
            token: rawTok,
          });
        }
        const restored = await ensureBusinessScrapeBuffer(textQuery, bias, qNorm, pageSize);
        buf = scrapeBusinessInfiniteBuffer;
        if (!restored || !buf || buf.norm !== qNorm) {
          return openApiSearchChunk(textQuery, options, virtOffBiz, pageSize, queryCacheKey);
        }
      }
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[NaverMobileBusinessScrape]', {
          source: 'thumb_enriched_chunk',
          query: textQuery,
          sampleThumbs: buf.rows
            .slice(virtOffBiz, virtOffBiz + pageSize)
            .slice(0, 3)
            .map((r) => ({ id: r.id, thumb: r.thumbnailUrl ?? null })),
        });
      }
      return sliceBusinessScrapeChunk(buf, virtOffBiz, pageSize, textQuery, bias, coords, queryCacheKey);
    }
  }

  if (Platform.OS === 'android' && ScrapingBusinessSearchService.isAvailable()) {
    const bizScrapeQuery = buildBizScrapeQuery(textQuery, bias);
    const qNorm = scrapeQueryNormForBuffer(bizScrapeQuery);
    if (rawTok === '' || rawTok === '1') {
      const scrapeT0 = Date.now();
      try {
        const scraped =
          await ScrapingBusinessSearchService.fetchMappedMobilePlacesNoDetail(bizScrapeQuery);
        if (scraped && scraped.length > 0) {
          scrapeBusinessInfiniteBuffer = { norm: qNorm, rows: scraped };
          const slice = scraped.slice(0, pageSize);
          scheduleAndroidThumbnailEnrich(slice);
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('[NaverMobileBusinessScrape]', {
              source: 'thumb_enriched_first',
              query: textQuery,
              sampleThumbs: slice.slice(0, 3).map((r) => ({ id: r.id, thumb: r.thumbnailUrl ?? null })),
            });
          }
          const nextTok =
            scraped.length > pageSize ? encodeBusinessScrapeVirtualPageToken(pageSize) : null;
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('[NaverMobileBusinessScrape]', {
              source: 'scrape',
              query: textQuery,
              locationBias: bias ?? null,
              userCoords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
              chunkCount: slice.length,
              totalParsed: scraped.length,
              nextPageToken: nextTok,
              totalMs: Date.now() - scrapeT0,
            });
          }
          return finalizeSearchResult(slice, nextTok, queryCacheKey, {
            norm: qNorm,
            rows: scraped,
          });
        }
        scrapeBusinessInfiniteBuffer = null;
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[NaverMobileBusinessScrape]', {
            source: 'scrape_empty',
            query: bizScrapeQuery,
            scrapedLength: scraped?.length ?? 0,
            fallback: 'openapi',
          });
        }
      } catch (e) {
        scrapeBusinessInfiniteBuffer = null;
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[NaverMobileBusinessScrape]', { source: 'scrape_error', fallback: 'openapi', err: e });
        }
      }
    }
  }

  return openApiSearchChunk(textQuery, options, null, pageSize, queryCacheKey);
}

function hasPlaceSearchRowCoordinates(row: PlaceSearchRow): boolean {
  return (
    row.latitude != null &&
    row.longitude != null &&
    Number.isFinite(row.latitude) &&
    Number.isFinite(row.longitude)
  );
}

/** 목록에 좌표가 없으면 NCP 지오코딩으로 보강(네이버 지역 검색 응답). */
export async function resolvePlaceSearchRowCoordinates(row: PlaceSearchRow): Promise<PlaceSearchRow> {
  let base: PlaceSearchRow = { ...row };
  let detailAddressLine: string | null = null;

  if (hasPlaceSearchRowCoordinates(base)) {
    if (detailAddressLine) {
      return {
        ...base,
        roadAddress: detailAddressLine,
        address: detailAddressLine,
      };
    }
    return base;
  }

  const resolved = await resolveNaverPlaceCoordinates({
    id: base.id,
    title: base.title,
    address: base.address,
    roadAddress: base.roadAddress,
    category: base.category,
    link: base.link,
    latitude: base.latitude,
    longitude: base.longitude,
  });

  if (detailAddressLine) {
    return {
      ...base,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      roadAddress: detailAddressLine,
      address: detailAddressLine,
    };
  }

  return {
    ...base,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    roadAddress: resolved.roadAddress || base.roadAddress,
    address: resolved.address || base.address,
  };
}

/** 검색 결과 로딩 시점에 좌표 없는 행만 미리 보강합니다. 실패한 행은 원본을 유지합니다. */
export async function preloadPlaceSearchRowsCoordinates(rows: readonly PlaceSearchRow[]): Promise<PlaceSearchRow[]> {
  if (rows.length === 0) return [];
  return Promise.all(
    rows.map(async (row) => {
      if (hasPlaceSearchRowCoordinates(row)) return row;
      try {
        return await resolvePlaceSearchRowCoordinates(row);
      } catch (e) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[NaverLocalKeywordSearch]', {
            source: 'preload_coordinate_failed',
            id: row.id,
            title: row.title,
            address: row.roadAddress || row.address,
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return row;
      }
    }),
  );
}
