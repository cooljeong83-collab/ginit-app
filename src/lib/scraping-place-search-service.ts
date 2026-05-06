import { Platform } from 'react-native';

import { requireOptionalNativeModule } from 'expo-modules-core';

import type { PlaceSearchRow } from '@/src/lib/place-search-row';
import { resolveNaverPlacePageUrlFromLinkField, sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';

export type NativeScrapedPlaceRow = {
  title: string;
  category?: string | null;
  address?: string | null;
  link?: string | null;
  /** 모바일 검색 목록 행에서 추출한 첫 이미지 URL */
  thumbnailUrl?: string | null;
  /** 네이버 place numeric id (가능하면 dedupe에 사용) */
  placeId?: string | null;
};

type NativePlaceDetailScrapeRow = {
  thumbnailUrl?: string | null;
  address?: string | null;
  roadAddress?: string | null;
};

type NaverMobilePlaceScrapeNative = {
  searchMobilePlaces: (query: string) => Promise<NativeScrapedPlaceRow[]>;
  scrapePlaceDetailPage?: (placePageUrl: string) => Promise<NativePlaceDetailScrapeRow | Record<string, unknown>>;
};

function stableScrapeId(parts: readonly string[]): string {
  const s = parts.map((p) => p.trim()).join('\u001d');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  const unsigned = h >>> 0;
  return `scrape-${unsigned.toString(16)}`;
}

function getNativeModule(): NaverMobilePlaceScrapeNative | null {
  if (Platform.OS !== 'android') return null;
  return requireOptionalNativeModule<NaverMobilePlaceScrapeNative>('NaverMobilePlaceScrape');
}

/**
 * 통합검색 카드에는 도로명까지 나오는 행과 시·구·동만 노출되는 행이 섞입니다.
 * 후자는 문자열이 비어 있지 않아도 상세 페이지에서 한 줄 주소를 받아 보강하는 편이 안전합니다.
 */
function listSnippetLikelyMissingRoadAddress(addr: string): boolean {
  const t = addr.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if ((t.includes('로') || t.includes('길')) && /\d/.test(t)) return false;
  if (/\d/.test(t) && (t.includes('층') || t.includes('호'))) return false;
  if (!/\d/.test(t)) return true;
  return t.length < 14;
}

function normalizeScrapedThumbnailToHttps(raw: string | null | undefined): string | undefined {
  const t = (raw ?? '').trim();
  if (!t) return undefined;
  if (t.startsWith('https://')) return t;
  if (t.startsWith('http://')) return `https://${t.slice('http://'.length)}`;
  if (t.startsWith('//')) return `https:${t}`;
  return undefined;
}

function mapNativeToPlaceSearchRow(row: NativeScrapedPlaceRow): PlaceSearchRow {
  const title = (row.title ?? '').trim();
  // 검색 결과의 "더보기" 같은 UI 라벨 행은 업체가 아니므로 제외(상위에서 필터링)
  if (title === '더보기' || /^이미지\s*수?\s*\d+$/u.test(title) || /^이미지수\d+$/u.test(title)) {
    return {
      id: 'scrape-skip-more',
      title,
      address: '',
      roadAddress: '',
      category: '',
      latitude: null,
      longitude: null,
    };
  }
  const address = (row.address ?? '').trim();
  const category = (row.category ?? '').trim();
  const roadAddress = '';
  const link0 = sanitizeNaverLocalPlaceLink(row.link ?? undefined);
  const link = (() => {
    const u = (link0 ?? '').trim();
    const m = /^https?:\/\/m\.place\.naver\.com\/place\/(\d+)\b/.exec(u);
    return m?.[1] ? `https://m.place.naver.com/place/${m[1]}` : link0;
  })();
  const thumbnailUrl = normalizeScrapedThumbnailToHttps(row.thumbnailUrl ?? undefined);
  const placeIdRaw = (row.placeId ?? '').trim();
  const placeIdFromLink = (() => {
    const u = (link ?? '').trim();
    const m = /\/place\/(\d+)/.exec(u);
    return m?.[1]?.trim() ?? '';
  })();
  const placeId = /^\d+$/.test(placeIdRaw)
    ? placeIdRaw
    : /^\d+$/.test(placeIdFromLink)
      ? placeIdFromLink
      : '';
  const id = placeId ? `scrape-place-${placeId}` : stableScrapeId([title, address, category]);
  return {
    id,
    title,
    /** 빈 값이면 상세 스크랩·지오코딩으로 보강 — 상호명을 주소로 쓰지 않음 */
    address: address || '',
    roadAddress,
    category,
    ...(link ? { link } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    latitude: null,
    longitude: null,
  };
}

function normalizeScrapeQueryVariants(query: string): string[] {
  const q0 = query.replace(/\s+/g, ' ').trim();
  if (!q0) return [];
  const variants: string[] = [q0];
  const add = (q: string) => {
    const t = q.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (variants.includes(t)) return;
    variants.push(t);
  };
  // 네이버 모바일 검색은 복합 명사를 띄어쓰면 결과 DOM 구조가 달라지거나,
  // 검색 자체가 약해지는 케이스가 있어 스크래핑에서는 붙여쓰기 변형을 함께 시도합니다.
  add(q0.replace(/스크린\s*골프/gi, '스크린골프'));
  add(q0.replace(/보드\s*게임\s*카페/gi, '보드게임카페'));
  add(q0.replace(/방\s*탈출\s*카페/gi, '방탈출카페'));
  add(q0.replace(/한강\s*공원/gi, '한강공원'));
  add(q0.replace(/PC\s*방/gi, 'PC방').replace(/피시\s*방/gi, '피시방').replace(/피씨\s*방/gi, '피씨방'));
  // 스크린골프는 "장"이 붙는 검색이 더 잘 되는 경우가 있어 폴백을 추가합니다.
  if (/스크린골프/i.test(q0) && !/스크린골프장/i.test(q0)) {
    add(q0.replace(/스크린골프/gi, '스크린골프장'));
  }
  return variants;
}

/**
 * Android: Jsoup 기반 네이버 모바일 검색 스크래핑.
 * 모듈이 없거나 비 Android면 null 반환(호출 측에서 Open API 폴백).
 */
export const ScrapingPlaceSearchService = {
  isAvailable(): boolean {
    return getNativeModule() != null;
  },

  /**
   * Android: `m.place.naver.com` 상세 HTML에서 첫 대표 이미지·주소(한 줄) 추출.
   * 링크가 플레이스가 아니거나 모듈/메서드 없음·실패 시 null.
   */
  async enrichPlaceSearchRowFromDetailPage(row: PlaceSearchRow): Promise<Partial<PlaceSearchRow> | null> {
    const mod = getNativeModule();
    if (!mod || typeof mod.scrapePlaceDetailPage !== 'function') return null;
    const pageUrl = resolveNaverPlacePageUrlFromLinkField(row.link);
    if (!pageUrl) return null;
    const t0 = Date.now();
    let raw: NativePlaceDetailScrapeRow | Record<string, unknown>;
    try {
      raw = (await mod.scrapePlaceDetailPage(pageUrl)) as NativePlaceDetailScrapeRow;
    } catch (e) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[ScrapingPlaceSearchService]', {
          phase: 'place_detail_scrape_error',
          url: pageUrl,
          ms: Date.now() - t0,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return null;
    }
    if (raw == null || typeof raw !== 'object') return null;
    const patch: Partial<PlaceSearchRow> = {};
    const thumb = normalizeScrapedThumbnailToHttps(
      typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl : undefined,
    );
    if (thumb) patch.thumbnailUrl = thumb;
    const addr = typeof raw.address === 'string' ? raw.address.trim() : '';
    const road = typeof raw.roadAddress === 'string' ? raw.roadAddress.trim() : '';
    const line = (addr || road).trim();
    if (line) {
      patch.address = line;
      patch.roadAddress = line;
    }
    if (__DEV__ && (thumb || line)) {
      // eslint-disable-next-line no-console
      console.log('[ScrapingPlaceSearchService]', {
        phase: 'place_detail_ok',
        url: pageUrl,
        ms: Date.now() - t0,
        hasThumb: Boolean(thumb),
        addressLen: line.length,
      });
    }
    return Object.keys(patch).length > 0 ? patch : null;
  },

  /**
   * 네이티브 SERP 한 번만 긁어 `PlaceSearchRow`로 매핑합니다(상세 주소 보강 없음 — UI 청크마다 따로 호출).
   */
  async fetchMappedMobilePlacesNoDetail(query: string): Promise<PlaceSearchRow[] | null> {
    const mod = getNativeModule();
    if (!mod) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[ScrapingPlaceSearchService]', { phase: 'skip', reason: 'native_module_null', query: query.trim() });
      }
      return null;
    }
    const q = query.trim();
    if (!q) return [];
    const t0 = Date.now();
    let raw: NativeScrapedPlaceRow[] = [];
    let usedQuery = q;
    try {
      const variants = normalizeScrapeQueryVariants(q);
      for (const v of variants) {
        usedQuery = v;
        raw = await mod.searchMobilePlaces(v);
        if (Array.isArray(raw) && raw.length > 0) break;
      }
    } catch (e) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[ScrapingPlaceSearchService]', {
          phase: 'native_error',
          query: usedQuery,
          ms: Date.now() - t0,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      throw e;
    }
    const ms = Date.now() - t0;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[ScrapingPlaceSearchService]', {
        phase: 'native_ok',
        query: usedQuery,
        ms,
        rawCount: Array.isArray(raw) ? raw.length : -1,
        sampleRaw: Array.isArray(raw) ? raw.slice(0, 3) : raw,
      });
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[ScrapingPlaceSearchService]', {
          phase: 'empty_rows',
          query: usedQuery,
          ms,
          hint: 'Android logcat: adb logcat -s NaverMobilePlaceScrape:D',
        });
      }
      return [];
    }
    const mapped0 = raw
      .map(mapNativeToPlaceSearchRow)
      .filter((r) => r.id !== 'scrape-skip-more');
    // 같은 placeId(/place/<id>)에서 파생된 행(사진탭/리뷰탭 등)이 섞여 들어오는 케이스가 있어
    // UI key 충돌 방지를 위해 id 기준으로 1건만 남깁니다.
    const seen = new Set<string>();
    const mapped: PlaceSearchRow[] = [];
    for (const r of mapped0) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      mapped.push(r);
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[ScrapingPlaceSearchService]', {
        phase: 'mapped_no_detail',
        query: usedQuery,
        ms,
        placeCount: mapped.length,
        samplePlaces: mapped
          .slice(0, 3)
          .map((p) => ({ id: p.id, title: p.title, address: p.address, link: p.link, thumbnailUrl: p.thumbnailUrl })),
      });
    }
    return mapped;
  },

  /** 전달된 행만 상세 스크랩 보강(객체 참조 유지 — 버퍼와 동일 참조여야 함). */
  async enrichRowsNeedingDetail(rows: PlaceSearchRow[]): Promise<void> {
    const mod = getNativeModule();
    if (!mod || typeof mod.scrapePlaceDetailPage !== 'function') return;
    const pending: PlaceSearchRow[] = [];
    for (const row of rows) {
      const line = `${(row.address ?? '').trim() || (row.roadAddress ?? '').trim()}`;
      if (!(row.link ?? '').trim()) continue;
      if (listSnippetLikelyMissingRoadAddress(line)) pending.push(row);
    }
    const chunkSize = 3;
    for (let c = 0; c < pending.length; c += chunkSize) {
      await Promise.all(
        pending.slice(c, c + chunkSize).map(async (row) => {
          const patch = await ScrapingPlaceSearchService.enrichPlaceSearchRowFromDetailPage(row);
          if (patch && Object.keys(patch).length > 0) Object.assign(row, patch);
        }),
      );
    }
  },
};
