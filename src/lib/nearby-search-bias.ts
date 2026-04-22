import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import type { LatLng } from '@/src/lib/geo-distance';

let cache: Promise<{ bias: string | null; coords: LatLng | null }> | null = null;

/**
 * 모임 등록·장소 검색에서 네이버 지역 검색 쿼리에 붙일 **행정구역 힌트**와 좌표.
 * `bias`는 `resolveFeedLocationContext().labelShort`(구 단위, 실패 시 폴백 구)를 쓰며, 좌표가 없어도 동일 라벨을 반환합니다.
 * 한 세션에서 위치 요청은 한 번만 수행합니다.
 */
export function ensureNearbySearchBias(): Promise<{ bias: string | null; coords: LatLng | null }> {
  if (!cache) {
    cache = (async () => {
      const ctx = await resolveFeedLocationContext();
      const label = ctx.labelShort?.trim();
      /** 구 라벨은 좌표 실패·권한 거부 시에도 `FEED_LOCATION_FALLBACK_SHORT` 등으로 채워지므로, 추천 검색어·쿼리 보강에는 항상 사용 */
      return {
        bias: label && label.length > 0 ? label : null,
        coords: ctx.coords,
      };
    })();
  }
  return cache;
}
