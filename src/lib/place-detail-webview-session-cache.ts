import { normalizeNaverPlaceDetailWebUrl } from '@/src/lib/naver-local-search';

/** 세션 내 유지할 장소 상세 WebView 슬롯 수 */
export const PLACE_DETAIL_WEBVIEW_POOL_MAX = 5;

const loadedKeys = new Set<string>();
const lruOrder: string[] = [];

function normalizeCacheKeyPart(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * 장소 상세 WebView 캐시 키 — `placeKey` 우선, 없으면 정규화 URL.
 */
export function buildPlaceWebViewCacheKey(
  webViewUri: string,
  placeKey?: string | null,
): string {
  const pk = normalizeCacheKeyPart(placeKey);
  if (pk) return pk;
  return normalizeCacheKeyPart(normalizeNaverPlaceDetailWebUrl(webViewUri)) || webViewUri.trim();
}

export function isPlaceWebViewLoaded(cacheKey: string): boolean {
  const key = normalizeCacheKeyPart(cacheKey);
  return key.length > 0 && loadedKeys.has(key);
}

export function markPlaceWebViewLoaded(cacheKey: string): void {
  const key = normalizeCacheKeyPart(cacheKey);
  if (!key) return;
  loadedKeys.add(key);
  touchPlaceWebViewLru(key);
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[PlaceDetailWebViewCache]', { event: 'loaded', key, poolSize: lruOrder.length });
  }
}

/** LRU 순서 갱신 — 풀 evict 대상은 가장 오래된 키 */
export function touchPlaceWebViewLru(cacheKey: string): void {
  const key = normalizeCacheKeyPart(cacheKey);
  if (!key) return;
  const idx = lruOrder.indexOf(key);
  if (idx >= 0) lruOrder.splice(idx, 1);
  lruOrder.push(key);
}

export function getPlaceWebViewLruKeys(): readonly string[] {
  return lruOrder;
}

/** 풀에 새 키를 넣기 전 호출 — cap 초과 시 evict 할 키 반환 */
export function registerPlaceWebViewPoolKey(cacheKey: string): string | null {
  const key = normalizeCacheKeyPart(cacheKey);
  if (!key) return null;
  const alreadyInPool = lruOrder.includes(key);
  touchPlaceWebViewLru(key);
  if (alreadyInPool) return null;
  while (lruOrder.length > PLACE_DETAIL_WEBVIEW_POOL_MAX) {
    const evicted = lruOrder.shift();
    if (!evicted) break;
    if (evicted === key) continue;
    loadedKeys.delete(evicted);
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[PlaceDetailWebViewCache]', { event: 'evict', key: evicted });
    }
    return evicted;
  }
  return null;
}

export function unregisterPlaceWebViewPoolKey(cacheKey: string): void {
  const key = normalizeCacheKeyPart(cacheKey);
  if (!key) return;
  const idx = lruOrder.indexOf(key);
  if (idx >= 0) lruOrder.splice(idx, 1);
  loadedKeys.delete(key);
}

/** 테스트·메모리 디버그용 */
export function clearPlaceWebViewSessionCache(): void {
  loadedKeys.clear();
  lruOrder.length = 0;
}
