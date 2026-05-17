import { haystackMatchesFeedRegion, normalizeFeedRegionLabel } from '@/src/lib/feed-region-match';
import { pointInSeoulGuLatLngBounds } from '@/src/lib/seoul-gu-latlng-bounds';
import { SEOUL_GU_SET, type SeoulGuLabel } from '@/src/lib/seoul-gu-constants';

export type PlaceRegionCheckInput = {
  placeName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type PlaceRegionGateResult =
  | { ok: true }
  | { ok: false; title: string; message: string };

/** 피드 `meetingMatchesSelectedRegion`과 동일 — 장소명·주소 결합 */
export function buildPlaceRegionHaystack(placeName?: string | null, address?: string | null): string {
  return [placeName, address]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join(' ');
}

/** 단일 관심지역(정규화 라벨)과 장소가 맞는지 — 주소 우선, 서울 구는 좌표 bbox 보완 */
export function placeMatchesInterestRegion(place: PlaceRegionCheckInput, regionLabel: string): boolean {
  const hay = buildPlaceRegionHaystack(place.placeName, place.address);
  if (haystackMatchesFeedRegion(hay, regionLabel)) return true;

  const norm = normalizeFeedRegionLabel(regionLabel);
  if (!norm || !SEOUL_GU_SET.has(norm)) return false;

  const lat = place.latitude;
  const lng = place.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return pointInSeoulGuLatLngBounds(lat, lng, norm as SeoulGuLabel);
}

/** 등록 관심지역 목록 중 하나라도 맞으면 true. 목록이 비면 false */
export function placeMatchesAnyRegisteredInterestRegion(
  place: PlaceRegionCheckInput,
  registeredRegions: readonly string[],
): boolean {
  if (registeredRegions.length === 0) return false;
  return registeredRegions.some((r) => placeMatchesInterestRegion(place, r));
}

export function formatMeetingCreatePlaceRegionBlockMessage(registeredRegions: readonly string[]): string {
  const labels = registeredRegions.map((r) => normalizeFeedRegionLabel(r)).filter((x) => x.length > 0);
  const summary =
    labels.length === 0
      ? '관심 지역'
      : labels.length === 1
        ? labels[0]!
        : labels.length === 2
          ? `${labels[0]!}, ${labels[1]!}`
          : `${labels[0]!} 외 ${labels.length - 1}곳`;
  return `등록한 관심 지역(${summary}) 밖이에요. 해당 지역 안의 장소만 후보로 등록할 수 있어요.`;
}

export function gatePlaceAgainstRegisteredInterestRegions(
  place: PlaceRegionCheckInput,
  registeredRegions: readonly string[],
): PlaceRegionGateResult {
  if (registeredRegions.length === 0) {
    return {
      ok: false,
      title: '관심 지역 필요',
      message: '탐색에서 관심 지역을 한 곳 이상 등록한 뒤 장소 후보를 선택해 주세요.',
    };
  }
  if (placeMatchesAnyRegisteredInterestRegion(place, registeredRegions)) {
    return { ok: true };
  }
  return {
    ok: false,
    title: '관심 지역 밖 장소',
    message: formatMeetingCreatePlaceRegionBlockMessage(registeredRegions),
  };
}
