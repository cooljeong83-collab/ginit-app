import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';
import { normalizeCorsProxyBase } from '@/src/lib/naver-ncp-maps';

/** 카카오맵 장소 상세(HTML) — `place_url` */
const KAKAO_PLACE_HOST = /(^|\.)place\.map\.kakao\.com$/i;

/**
 * 카카오맵 장소 페이지 URL인지(키워드 검색 `place_url` 등).
 * 참고: `#photoList?type=all&pidx=0` 는 브라우저 라우팅용이며 HTTP GET에는 포함되지 않습니다.
 */
export function isKakaoMapPlacePageUrl(url: string | null | undefined): boolean {
  const t = (url ?? '').trim();
  if (!t) return false;
  try {
    const u = new URL(t.startsWith('http://') || t.startsWith('https://') ? t : `https://${t}`);
    return KAKAO_PLACE_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

function wrapHtmlFetchUrlForWeb(absoluteHttpsUrl: string): string {
  if (Platform.OS !== 'web') return absoluteHttpsUrl;
  const proxyRaw = publicEnv.naverLocalSearchCorsProxy?.trim();
  if (!proxyRaw) return absoluteHttpsUrl;
  return `${normalizeCorsProxyBase(proxyRaw)}/${absoluteHttpsUrl}`;
}

function absolutizeImageUrl(pageUrl: string, raw: string): string | null {
  const c = raw.trim().replace(/&amp;/g, '&');
  if (!c) return null;
  if (c.startsWith('https://')) return c;
  if (c.startsWith('//')) return `https:${c}`;
  if (c.startsWith('http://')) return null;
  try {
    const base = new URL(pageUrl);
    const u = new URL(c, base);
    if (u.protocol === 'https:') return u.href;
  } catch {
    /* ignore */
  }
  return null;
}

function extractOgImageFromHtml(html: string, pageUrl: string): string | null {
  const slice = html.length > 280_000 ? html.slice(0, 280_000) : html;
  const patterns: RegExp[] = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /<meta\s+property=["']og:image:url["']\s+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = slice.match(re);
    if (m?.[1]) {
      const abs = absolutizeImageUrl(pageUrl, m[1]);
      if (abs) return abs;
    }
  }
  return null;
}

/**
 * 카카오맵 장소 HTML에서 대표 이미지 URL 추출.
 * `#photoList?type=all&pidx=0` 는 서버 응답을 바꾸지 않으므로, 일반 상세 페이지의 og:image를 사용합니다.
 */
export async function fetchKakaoPlacePageThumbnailUrl(placePageUrl: string): Promise<string | null> {
  const raw = placePageUrl.trim();
  if (!raw || !isKakaoMapPlacePageUrl(raw)) return null;

  let pageUrl: string;
  try {
    const u = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    u.hash = '';
    pageUrl = u.toString();
  } catch {
    return null;
  }

  const fetchUrl = wrapHtmlFetchUrlForWeb(pageUrl);

  try {
    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractOgImageFromHtml(html, pageUrl);
  } catch {
    return null;
  }
}
