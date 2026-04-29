import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import type { LatLng } from '@/src/lib/geo-distance';
import { loadActiveFeedRegion } from '@/src/lib/feed-registered-regions';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';

let cache: Promise<{ bias: string | null; coords: LatLng | null }> | null = null;

/** `/create/details` 이탈 후 다음 모임 생성에서 GPS 기준 힌트를 다시 쓰도록 비웁니다. */
export function invalidateNearbySearchBiasCache(): void {
  cache = null;
}

/**
 * 지도 탭에서 모임 만들기로 이동하기 직전 호출 — 이후 `ensureNearbySearchBias()` 첫 호출이 지도 중심 좌표를 사용합니다.
 */
export function applyNearbySearchBiasFromMapNavigation(coords: LatLng, biasLabel: string | null): void {
  const bias = biasLabel?.trim() ? biasLabel.trim() : null;
  cache = Promise.resolve({ bias, coords });
}

/**
 * 모임 등록·장소 검색에서 네이버 지역 검색 쿼리에 붙일 **행정구역 힌트**와 좌표.
 * `bias`는 “탐색 탭에서 사용자가 선택한 관심 지역(active)”을 최우선으로 사용합니다.
 * active가 없을 때만 GPS 기반 `resolveFeedLocationContext().labelShort`(구 단위, 실패 시 폴백 구)로 폴백합니다.
 * 한 세션에서 위치 요청은 한 번만 수행합니다.
 */
export function ensureNearbySearchBias(): Promise<{ bias: string | null; coords: LatLng | null }> {
  if (!cache) {
    cache = (async () => {
      const active = (await loadActiveFeedRegion())?.trim() ?? '';
      if (active) {
        const cached = await loadFeedLocationCache();
        return { bias: active, coords: cached?.coords ?? null };
      }
      const ctx = await resolveFeedLocationContext();
      const label = ctx.labelShort?.trim();
      /** 구 라벨은 좌표 실패·권한 거부 시에도 `FEED_LOCATION_FALLBACK_SHORT` 등으로 채워지므로, 추천 검색어·쿼리 보강에는 항상 사용 */
      return { bias: label && label.length > 0 ? label : null, coords: ctx.coords };
    })();
  }
  return cache;
}
