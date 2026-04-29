import type { LatLng } from '@/src/lib/geo-distance';
import type { Meeting } from '@/src/lib/meetings';

/** 이 값보다 `latitudeDelta`가 작으면(더 확대) 개별 프로필 마커 모드 — 클러스터는 SuperCluster가 멀리서만 유지 */
export const MAP_AVATAR_CLUSTERING_MAX_DELTA = 0.055;

/** 동일 좌표로 간주할 소수 자릿수(약 수십 m 단위 그룹) */
const OVERLAP_DECIMALS = 4;

export function meetingCoordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(OVERLAP_DECIMALS)},${lng.toFixed(OVERLAP_DECIMALS)}`;
}

export function groupMeetingsByCoordinateOverlap(meetings: readonly Meeting[]): Map<string, Meeting[]> {
  const map = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const lat = m.latitude;
    const lng = m.longitude;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const k = meetingCoordinateKey(lat, lng);
    const prev = map.get(k);
    if (prev) prev.push(m);
    else map.set(k, [m]);
  }
  return map;
}

export function spiralOffsetsMeters(count: number, baseRadiusM = 14, stepM = 10): { east: number; north: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ east: 0, north: 0 }];
  const out: { east: number; north: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count + 0.35;
    const r = baseRadiusM + stepM * i * 0.35;
    out.push({ east: r * Math.cos(angle), north: r * Math.sin(angle) });
  }
  return out;
}

/** 북·동 방향 미터 오프셋을 위경도 델타로 변환 */
export function offsetMetersToLatLng(lat: number, lng: number, northM: number, eastM: number): LatLng {
  const metersPerDegLat = 111_320;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const denomLng = Math.max(0.2, Math.abs(cosLat)) * metersPerDegLat;
  return {
    latitude: lat + northM / metersPerDegLat,
    longitude: lng + eastM / denomLng,
  };
}
