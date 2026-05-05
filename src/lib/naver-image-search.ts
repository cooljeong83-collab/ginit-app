import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
import { fetchKakaoPlacePageThumbnailUrl, isKakaoMapPlacePageUrl } from '@/src/lib/kakao-place-page-image';
import { withCorsProxyForWeb } from '@/src/lib/naver-ncp-maps';
import { withNaverOpenApiClientRateLimit } from '@/src/lib/naver-openapi-rate-limit';

type NaverOpenApiImageJson = {
  items?: {
    /** 썸네일 URL */
    thumbnail?: string;
    /** 원본/상세 링크 */
    link?: string;
    /** HTML 포함 가능 */
    title?: string;
  }[];
};

function normalizeHttpsUrl(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (!s.startsWith('https://')) return null;
  return s;
}

function cacheKeyForQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

const thumbnailCache = new Map<string, string | null>();
/** 장소 전용: 검색어 보강 + 다중 후보 중 상호·주소 정합도로 고름 */
const placeThumbnailCache = new Map<string, string | null>();

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export type NaverPlaceImageSearchFields = {
  title: string;
  roadAddress?: string | null;
  address?: string | null;
  /** 한 줄 주소(도로명·지번 혼합) — 투표 칩 `sub` 등 */
  addressLine?: string | null;
  category?: string | null;
  /** Kakao/기타에서 이미 구한 사진 URL이 있으면 추가 검색을 하지 않습니다. */
  preferredPhotoMediaUrl?: string | null;
  /** Kakao 키워드 검색 `place_url` 등 — HTML `og:image`로 썸네일 시도 후 네이버 이미지 폴백 */
  kakaoPlaceDetailPageUrl?: string | null;
};

/**
 * 네이버 이미지 검색 쿼리: 상호 + (도로명·지번 동시 반영 시 둘 다) + 주소 한 줄,
 * 주소가 전혀 없을 때만 카테고리를 붙입니다.
 */
export function buildNaverPlaceImageSearchQuery(f: NaverPlaceImageSearchFields): string {
  let title = stripHtmlTags(typeof f.title === 'string' ? f.title : '');
  const line = typeof f.addressLine === 'string' ? f.addressLine.trim() : '';
  let road = typeof f.roadAddress === 'string' ? f.roadAddress.trim() : '';
  let jibun = typeof f.address === 'string' ? f.address.trim() : '';
  const cat = typeof f.category === 'string' ? f.category.trim() : '';

  if (!road && !jibun && line) {
    road = line;
  }

  if (road && jibun) {
    const rLower = road.toLowerCase();
    const jLower = jibun.toLowerCase();
    if (rLower === jLower) {
      jibun = '';
    } else if (rLower.includes(jLower) || jLower.includes(rLower)) {
      if (road.length >= jibun.length) jibun = '';
      else road = '';
    }
  }

  if (!title) {
    const fallback = [line, road, jibun, cat].find((x) => typeof x === 'string' && x.trim().length > 0);
    return (fallback ?? '').trim();
  }

  const parts: string[] = [title];
  if (road) parts.push(road);
  if (jibun) parts.push(jibun);
  if (!road && !jibun && cat) parts.push(cat);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** `useEffect` 의존값용 안정 키 */
export function placeImageSearchCacheKey(f: NaverPlaceImageSearchFields): string {
  return [
    cacheKeyForQuery(f.title),
    cacheKeyForQuery(typeof f.roadAddress === 'string' ? f.roadAddress : ''),
    cacheKeyForQuery(typeof f.address === 'string' ? f.address : ''),
    cacheKeyForQuery(typeof f.addressLine === 'string' ? f.addressLine : ''),
    cacheKeyForQuery(typeof f.category === 'string' ? f.category : ''),
    cacheKeyForQuery(typeof f.preferredPhotoMediaUrl === 'string' ? f.preferredPhotoMediaUrl : ''),
    cacheKeyForQuery(typeof f.kakaoPlaceDetailPageUrl === 'string' ? f.kakaoPlaceDetailPageUrl : ''),
  ].join('\x1e');
}

function resolveRoadJibunForScoring(f: NaverPlaceImageSearchFields): { road: string; jibun: string } {
  const line = typeof f.addressLine === 'string' ? f.addressLine.trim() : '';
  let road = typeof f.roadAddress === 'string' ? f.roadAddress.trim() : '';
  let jibun = typeof f.address === 'string' ? f.address.trim() : '';
  if (!road && !jibun && line) {
    road = line;
  }
  if (road && jibun) {
    const rLower = road.toLowerCase();
    const jLower = jibun.toLowerCase();
    if (rLower === jLower) jibun = '';
    else if (rLower.includes(jLower) || jLower.includes(rLower)) {
      if (road.length >= jibun.length) jibun = '';
      else road = '';
    }
  }
  return { road, jibun };
}

function scoreImageTitleAgainstPlace(
  imageTitleRaw: string,
  placeTitle: string,
  road: string,
  jibun: string,
): number {
  const img = cacheKeyForQuery(stripHtmlTags(imageTitleRaw));
  if (!img) return 0;
  const pt = cacheKeyForQuery(stripHtmlTags(placeTitle));
  let score = 0;
  if (pt.length >= 4 && img.includes(pt)) score += 100;

  const tokens = pt.split(/[\s>]+/).filter((t) => t.length >= 3);
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    if (img.includes(tok)) score += Math.min(15, tok.length);
  }

  for (const fragRaw of [road, jibun]) {
    const frag = cacheKeyForQuery(fragRaw);
    if (frag.length >= 10 && img.includes(frag.slice(0, 22))) score += 25;
    else if (frag.length >= 6 && img.includes(frag.slice(0, 12))) score += 12;
  }
  return score;
}

async function fetchOpenApiImageSearch(
  query: string,
  opts?: { display?: number },
): Promise<NaverOpenApiImageJson> {
  const id = publicEnv.naverSearchClientId?.trim();
  const secret = publicEnv.naverSearchClientSecret?.trim();
  if (!id || !secret) {
    throw new Error(
      '이미지 검색용 키가 없습니다. env에 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID와 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET을 설정하세요.',
    );
  }

  const q = query.trim();
  const display = Math.min(100, Math.max(1, Math.floor(opts?.display ?? 1)));
  const baseUrl = `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(q)}&display=${display}&sort=sim`;

  return withNaverOpenApiClientRateLimit(async () => {
    let url = baseUrl;
    if (Platform.OS === 'web') {
      url = withCorsProxyForWeb(baseUrl);
    }

    const headers: Record<string, string> = {
      'X-Naver-Client-Id': id,
      'X-Naver-Client-Secret': secret,
      Accept: 'application/json',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`이미지 검색 API 오류 (${res.status}): ${t.slice(0, 200)}`);
    }
    return (await res.json()) as NaverOpenApiImageJson;
  });
}

export async function searchNaverImageThumbnail(query: string): Promise<string | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const key = cacheKeyForQuery(trimmed);
  if (thumbnailCache.has(key)) return thumbnailCache.get(key) ?? null;

  const json = await fetchOpenApiImageSearch(trimmed, { display: 1 });
  const first = json.items?.[0];
  const thumb = normalizeHttpsUrl(first?.thumbnail) ?? normalizeHttpsUrl(first?.link);
  thumbnailCache.set(key, thumb);
  return thumb;
}

/**
 * 장소 행·투표 칩용: `preferredPhotoMediaUrl`이 있으면 사용하고,
 * Kakao `place_url`이 있으면 해당 페이지 HTML의 `og:image`를 시도한 뒤,
 * 없으면 네이버 이미지 검색(`display` 10건 + 제목 정합도)으로 썸네일을 찾습니다.
 */
export async function searchNaverPlaceImageThumbnail(f: NaverPlaceImageSearchFields): Promise<string | null> {
  const q = buildNaverPlaceImageSearchQuery(f);
  const kakaoPage = typeof f.kakaoPlaceDetailPageUrl === 'string' ? f.kakaoPlaceDetailPageUrl.trim() : '';
  const canKakaoOg = Boolean(kakaoPage && isKakaoMapPlacePageUrl(kakaoPage));
  const cacheKey = `p|${cacheKeyForQuery(q)}|k:${cacheKeyForQuery(kakaoPage)}`;
  if (placeThumbnailCache.has(cacheKey)) return placeThumbnailCache.get(cacheKey) ?? null;

  const pref = typeof f.preferredPhotoMediaUrl === 'string' ? f.preferredPhotoMediaUrl.trim() : '';
  if (pref.startsWith('https://')) {
    placeThumbnailCache.set(cacheKey, pref);
    return pref;
  }

  if (!q && !canKakaoOg) {
    placeThumbnailCache.set(cacheKey, null);
    return null;
  }

  if (canKakaoOg) {
    try {
      const og = await fetchKakaoPlacePageThumbnailUrl(kakaoPage);
      if (og?.startsWith('https://')) {
        placeThumbnailCache.set(cacheKey, og);
        return og;
      }
    } catch {
      /* 네이버 이미지 검색으로 폴백 */
    }
  }

  if (!q) {
    placeThumbnailCache.set(cacheKey, null);
    return null;
  }

  const placeTitle = stripHtmlTags(typeof f.title === 'string' ? f.title : '');
  const { road, jibun } = resolveRoadJibunForScoring(f);

  const json = await fetchOpenApiImageSearch(q, { display: 10 });
  const items = json.items ?? [];

  type Ranked = { score: number; thumb: string };
  const ranked: Ranked[] = [];
  for (const it of items) {
    const titleRaw = typeof it?.title === 'string' ? it.title : '';
    const score = scoreImageTitleAgainstPlace(titleRaw, placeTitle, road, jibun);
    const thumb = normalizeHttpsUrl(it?.thumbnail) ?? normalizeHttpsUrl(it?.link);
    if (thumb) ranked.push({ score, thumb });
  }

  if (ranked.length === 0) {
    placeThumbnailCache.set(cacheKey, null);
    return null;
  }

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0]!.thumb;
  placeThumbnailCache.set(cacheKey, best);
  return best;
}
