/**
 * 서울시 25개 자치구 경계의 축정렬 바운딩박스 (WGS84).
 * 출처: southkorea/seoul-maps (KOSTAT 2013) municipalities GeoJSON 단순화본의 envelope.
 * 지도 화면이 특정 구일 때 해당 구 전체 모임(좌표·주소)을 포함하기 위한 판별용.
 */
import type { LocationGeocodedAddress } from 'expo-location';

import {
  extractGuFromKoreanAddressText,
  haystackMatchesFeedRegion,
  normalizeFeedRegionLabel,
} from '@/src/lib/feed-region-match';
import { guOnlyLabelFromGeocode } from '@/src/lib/feed-display-location';
import { haversineDistanceMeters, type LatLng } from '@/src/lib/geo-distance';
import type { Meeting } from '@/src/lib/meetings';
import {
  pointInSeoulGuLatLngBounds,
  SEOUL_GU_LATLNG_BOUNDS,
  type SeoulGuLatLngBounds,
} from '@/src/lib/seoul-gu-latlng-bounds';
import { type SeoulGuLabel, SEOUL_GU_SET } from '@/src/lib/seoul-gu-constants';

export type { SeoulGuLatLngBounds } from '@/src/lib/seoul-gu-latlng-bounds';
export { SEOUL_GU_LATLNG_BOUNDS } from '@/src/lib/seoul-gu-latlng-bounds';

export function seoulGuBboxCenter(gu: SeoulGuLabel): LatLng {
  const b = SEOUL_GU_LATLNG_BOUNDS[gu];
  return { latitude: (b.latMin + b.latMax) / 2, longitude: (b.lngMin + b.lngMax) / 2 };
}

/** 구 bbox 중심에서 가장 먼 모서리까지 거리 기반 RPC 반경(km), 상한·하한 적용 */
export function seoulGuFetchRadiusKm(gu: SeoulGuLabel): number {
  const b = SEOUL_GU_LATLNG_BOUNDS[gu];
  const c = seoulGuBboxCenter(gu);
  const corners: LatLng[] = [
    { latitude: b.latMin, longitude: b.lngMin },
    { latitude: b.latMin, longitude: b.lngMax },
    { latitude: b.latMax, longitude: b.lngMin },
    { latitude: b.latMax, longitude: b.lngMax },
  ];
  let maxM = 0;
  for (const p of corners) {
    maxM = Math.max(maxM, haversineDistanceMeters(c, p));
  }
  return Math.min(35, Math.max(6, (maxM / 1000) * 1.28 + 0.5));
}

export function meetingPointInSeoulGuBounds(m: Pick<Meeting, 'latitude' | 'longitude'>, gu: SeoulGuLabel): boolean {
  const lat = m.latitude;
  const lng = m.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return pointInSeoulGuLatLngBounds(lat, lng, gu);
}

export function meetingBelongsToSeoulGu(m: Meeting, gu: SeoulGuLabel): boolean {
  if (meetingPointInSeoulGuBounds(m, gu)) return true;
  const addr = (m.address ?? '').trim();
  if (addr && haystackMatchesFeedRegion(addr, gu)) return true;
  return false;
}

/** 역지오 라벨·정규화 문자열에서 서울 자치구 토큰만 추출 */
export function parseViewportLabelToSeoulGu(labelRaw: string): SeoulGuLabel | null {
  const raw = (labelRaw ?? '').trim();
  if (!raw) return null;
  const n = normalizeFeedRegionLabel(raw);
  if (n && SEOUL_GU_SET.has(n)) return n as SeoulGuLabel;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && (/^서울/i.test(parts[0]!) || /^seoul$/i.test(parts[0]!))) {
    const g = parts[parts.length - 1]!;
    if (SEOUL_GU_SET.has(g)) return g as SeoulGuLabel;
  }
  const g = extractGuFromKoreanAddressText(n) ?? extractGuFromKoreanAddressText(raw);
  if (g && SEOUL_GU_SET.has(g)) return g as SeoulGuLabel;
  return null;
}

export function seoulGuFromGeocodeAddress(a: LocationGeocodedAddress | null | undefined): SeoulGuLabel | null {
  if (!a) return null;
  const label = guOnlyLabelFromGeocode(a).trim();
  return parseViewportLabelToSeoulGu(label);
}
