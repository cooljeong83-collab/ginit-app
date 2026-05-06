import { Platform } from 'react-native';

import { requireOptionalNativeModule } from 'expo-modules-core';

import type { PlaceSearchRow } from '@/src/lib/place-search-row';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';

type NativeScrapedPlaceRow = {
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
};

type NaverMobilePlaceScrapeNative = {
  /** legacy: m.search 기반 (Place 전용) */
  searchMobilePlaces?: (query: string) => Promise<NativeScrapedPlaceRow[]>;
  /** Biz 전용: m.map 기반 */
  searchMobileMapPlaces?: (query: string) => Promise<NativeScrapedPlaceRow[]>;
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
  // m.map 결과 블록 안의 액션 라벨 행(가격/예약/길찾기 등)은 업체가 아니므로 제외합니다.
  const isMapActionLikeTitle =
    title === '주소보기' ||
    title === '공유' ||
    title === '지도' ||
    title === '길찾기' ||
    title === '전화' ||
    title === '가격' ||
    title === '예약' ||
    title === '검색결과';
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
  if (isMapActionLikeTitle) {
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
  // Biz(m.map) 목록에서 내려온 주소는 한 줄만 오는 경우가 많아 roadAddress도 같이 채워
  // UI가 즉시 표시할 수 있게 합니다(상세 보강은 사용하지 않음).
  const roadAddress = address || '';
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
    address: address || '',
    roadAddress,
    category,
    ...(link ? { link } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    latitude: null,
    longitude: null,
  };
}

function normalizeBusinessQueryVariants(query: string): string[] {
  const q0 = query.replace(/\s+/g, ' ').trim();
  if (!q0) return [];
  const variants: string[] = [q0];
  const add = (q: string) => {
    const t = q.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (variants.includes(t)) return;
    variants.push(t);
  };
  // Biz(m.map) 검색은 띄어쓰기가 의미를 갖는 경우가 많아 공백 제거 변형은 사용하지 않습니다.
  // 지점/브랜드 표기 변형
  add(q0.replace(/점\s*$/g, '').trim());
  add(q0.replace(/점$/g, '점').trim());
  return variants;
}

/**
 * Android: 네이버 모바일 검색 스크래핑(일반 상호 검색 전용).
 * - 음식점/카페가 아닌 "특정 상호명" 검색에서 OpenAPI보다 잘 잡히는 케이스를 보강합니다.
 * - 모듈이 없거나 비 Android면 null 반환(호출 측에서 Open API 폴백).
 */
export const ScrapingBusinessSearchService = {
  isAvailable(): boolean {
    const mod = getNativeModule();
    return Boolean(mod && typeof mod.searchMobileMapPlaces === 'function');
  },

  async fetchMappedMobilePlacesNoDetail(query: string): Promise<PlaceSearchRow[] | null> {
    const mod = getNativeModule();
    if (!mod || typeof mod.searchMobileMapPlaces !== 'function') {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[ScrapingBusinessSearchService]', {
          phase: 'skip',
          reason: !mod ? 'native_module_null' : 'missing_searchMobileMapPlaces',
          query: query.trim(),
        });
      }
      return null;
    }
    const q = query.trim();
    if (!q) return [];
    const t0 = Date.now();
    let raw: NativeScrapedPlaceRow[] = [];
    let usedQuery = q;
    try {
      const variants = normalizeBusinessQueryVariants(q);
      for (const v of variants) {
        usedQuery = v;
        raw = await mod.searchMobileMapPlaces(v);
        if (Array.isArray(raw) && raw.length > 0) break;
      }
    } catch (e) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[ScrapingBusinessSearchService]', {
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
      console.log('[ScrapingBusinessSearchService]', {
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
        console.warn('[ScrapingBusinessSearchService]', {
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
    const seen = new Set<string>();
    const mapped: PlaceSearchRow[] = [];
    for (const r of mapped0) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      mapped.push(r);
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[ScrapingBusinessSearchService]', {
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

  /** 전달된 행 중 썸네일이 비어있으면 상세(플레이스)에서 og:image로 보강 */
  async enrichRowsNeedingThumbnail(rows: PlaceSearchRow[]): Promise<void> {
    const mod = getNativeModule();
    if (!mod || typeof mod.scrapePlaceDetailPage !== 'function') return;
    const pending: PlaceSearchRow[] = [];
    for (const row of rows) {
      if ((row.thumbnailUrl ?? '').trim()) continue;
      if (!(row.link ?? '').trim()) continue;
      pending.push(row);
    }
    const chunkSize = 3;
    for (let c = 0; c < pending.length; c += chunkSize) {
      await Promise.all(
        pending.slice(c, c + chunkSize).map(async (row) => {
          try {
            const placeIdFromRow = (() => {
              const id = (row.id ?? '').trim();
              const m = /^scrape-place-(\d+)$/.exec(id);
              if (m?.[1]) return m[1];
              const link = (row.link ?? '').trim();
              const m2 = /\/place\/(\d+)/.exec(link);
              return m2?.[1] ?? '';
            })();
            // m.place는 베이스(/place/<id>)보다 /home 탭에서 og:image가 더 안정적으로 노출되는 경우가 있어 /home을 우선합니다.
            const detailUrl = placeIdFromRow
              ? `https://m.place.naver.com/place/${placeIdFromRow}/home`
              : row.link!;
            const raw = (await mod.scrapePlaceDetailPage!(detailUrl)) as NativePlaceDetailScrapeRow;
            const thumb = normalizeScrapedThumbnailToHttps(
              raw && typeof raw === 'object' && typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl : undefined,
            );
            if (thumb) row.thumbnailUrl = thumb;
          } catch {
            // ignore
          }
        }),
      );
    }
  },
};

