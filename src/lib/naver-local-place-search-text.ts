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
import { ScrapingPlaceSearchService } from '@/src/lib/scraping-place-search-service';

export { stableNaverLocalSearchDedupeKey } from '@/src/lib/naver-local-search';

/**
 * 네이버 지역 검색 응답을 모임 생성 등에서 쓰는 `PlaceSearchRow` 스키마로 유지.
 * @see https://developers.naver.com/docs/serviceapi/search/local/local.md
 */
export type PlaceSearchRow = {
  id: string;
  title: string;
  address: string;
  roadAddress: string;
  category: string;
  /** 네이버 지역 검색 `link`(플레이스·지도 등) */
  link?: string;
  /** 목록 직후에는 null — 선택 시 `resolvePlaceSearchRowCoordinates`로 NCP 지오코딩 */
  latitude: number | null;
  longitude: number | null;
  thumbnailUrl?: string | null;
};

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

function scrapeQueryNormForBuffer(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
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
  let textQuery = query.trim();
  const bias = options?.locationBias?.trim();
  const coords = options?.userCoords;
  if (bias && !coords && textQuery && !textQuery.includes(bias)) {
    textQuery = `${textQuery} ${bias}`.replace(/\s+/g, ' ').trim();
  }
  if (!textQuery) return { places: [], nextPageToken: null };

  const pageSize = Math.min(5, Math.max(1, Math.floor(options?.maxResultCount ?? 5)));
  const rawTok = (options?.pageToken ?? '').trim();

  if (Platform.OS === 'android' && ScrapingPlaceSearchService.isAvailable()) {
    const qNorm = scrapeQueryNormForBuffer(textQuery);
    const virtOff = parseScrapeVirtualPageToken(rawTok);

    if (virtOff != null) {
      const buf = scrapeInfiniteBuffer;
      if (!buf || buf.norm !== qNorm) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[NaverMobilePlaceScrape]', {
            source: 'scrape_buffer_miss',
            query: textQuery,
            token: rawTok,
          });
        }
        return { places: [], nextPageToken: null };
      }
      const slice = buf.rows.slice(virtOff, virtOff + pageSize);
      await ScrapingPlaceSearchService.enrichRowsNeedingDetail(slice);
      const nextOff = virtOff + slice.length;
      const nextTok = nextOff < buf.rows.length ? encodeScrapeVirtualPageToken(nextOff) : null;
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[NaverMobilePlaceScrape]', {
          source: 'scrape_chunk',
          query: textQuery,
          offset: virtOff,
          chunkCount: slice.length,
          totalParsed: buf.rows.length,
          nextPageToken: nextTok,
          locationBias: bias ?? null,
          userCoords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
        });
      }
      return { places: slice, nextPageToken: nextTok };
    }

    if (rawTok === '' || rawTok === '1') {
      const scrapeT0 = Date.now();
      try {
        const scraped = await ScrapingPlaceSearchService.fetchMappedMobilePlacesNoDetail(textQuery);
        if (scraped && scraped.length > 0) {
          scrapeInfiniteBuffer = { norm: qNorm, rows: scraped };
          const slice = scraped.slice(0, pageSize);
          await ScrapingPlaceSearchService.enrichRowsNeedingDetail(slice);
          const nextTok =
            scraped.length > pageSize ? encodeScrapeVirtualPageToken(pageSize) : null;
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log('[NaverMobilePlaceScrape]', {
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
          return { places: slice, nextPageToken: nextTok };
        }
        scrapeInfiniteBuffer = null;
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[NaverMobilePlaceScrape]', {
            source: 'scrape_empty',
            query: textQuery,
            scrapedLength: scraped?.length ?? 0,
            fallback: 'openapi',
          });
        }
      } catch (e) {
        scrapeInfiniteBuffer = null;
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[NaverMobilePlaceScrape]', { source: 'scrape_error', fallback: 'openapi', err: e });
        }
      }
    }
  }

  const page = parseNumericPageToken(options?.pageToken);
  const { places: naverPlaces, nextPageToken } = await searchNaverLocalKeywordPlacesPaginated(textQuery, {
    locationBias: options?.locationBias,
    page,
    pageSize,
    excludeStablePlaceKeys: page >= 2 ? options?.excludeStablePlaceKeys : undefined,
  });

  const places = naverPlaces.map(naverLocalToPlaceSearchRow);

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[NaverLocalKeywordSearch]', {
      query: textQuery,
      page,
      pageSize,
      locationBias: bias ?? null,
      userCoords: coords ? { latitude: coords.latitude, longitude: coords.longitude } : null,
      count: places.length,
      nextPageToken,
    });
  }

  return { places, nextPageToken };
}

/** 목록에 좌표가 없으면 NCP 지오코딩으로 보강(네이버 지역 검색 응답). */
export async function resolvePlaceSearchRowCoordinates(row: PlaceSearchRow): Promise<PlaceSearchRow> {
  let base: PlaceSearchRow = { ...row };
  let detailAddressLine: string | null = null;

  if (Platform.OS === 'android' && (row.link ?? '').trim().length > 0 && ScrapingPlaceSearchService.isAvailable()) {
    try {
      const patch = await ScrapingPlaceSearchService.enrichPlaceSearchRowFromDetailPage(row);
      if (patch && Object.keys(patch).length > 0) {
        base = { ...base, ...patch };
        const d = (patch.address ?? patch.roadAddress ?? '').trim();
        if (d) detailAddressLine = d;
      }
    } catch {
      // 상세 스크랩 실패 시 검색 행 기준으로 계속
    }
  }

  if (base.latitude != null && base.longitude != null) {
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
