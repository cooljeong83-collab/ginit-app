import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
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

async function fetchOpenApiImageSearch(query: string): Promise<NaverOpenApiImageJson> {
  const id = publicEnv.naverSearchClientId?.trim();
  const secret = publicEnv.naverSearchClientSecret?.trim();
  if (!id || !secret) {
    throw new Error(
      '이미지 검색용 키가 없습니다. env에 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID와 EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET을 설정하세요.',
    );
  }

  const q = query.trim();
  const baseUrl = `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(q)}&display=1&sort=sim`;

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

  const json = await fetchOpenApiImageSearch(trimmed);
  const first = json.items?.[0];
  const thumb = normalizeHttpsUrl(first?.thumbnail) ?? normalizeHttpsUrl(first?.link);
  thumbnailCache.set(key, thumb);
  return thumb;
}

