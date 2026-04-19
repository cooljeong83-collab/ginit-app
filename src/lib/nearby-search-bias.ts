import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import type { LatLng } from '@/src/lib/geo-distance';

let cache: Promise<{ bias: string | null; coords: LatLng | null }> | null = null;

/**
 * 모임 등록·장소 검색에서 네이버 지역 검색 쿼리에 붙일 **행정구역 힌트**와 좌표.
 * GPS·역지오가 실패하면 `bias`는 null (전국/키워드만 검색).
 * 한 세션에서 위치 요청은 한 번만 수행합니다.
 */
export function ensureNearbySearchBias(): Promise<{ bias: string | null; coords: LatLng | null }> {
  if (!cache) {
    cache = (async () => {
      const ctx = await resolveFeedLocationContext();
      if (!ctx.coords) {
        return { bias: null, coords: null };
      }
      const label = ctx.labelShort?.trim();
      return {
        bias: label && label.length > 0 ? label : null,
        coords: ctx.coords,
      };
    })();
  }
  return cache;
}
