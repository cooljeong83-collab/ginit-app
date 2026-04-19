import type { Meeting } from '@/src/lib/meetings';

const EARTH_RADIUS_M = 6371000;

export type LatLng = { latitude: number; longitude: number };

/** Haversine 거리 (미터). */
export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/** 모임 좌표가 있으면 사용자까지 거리(m), 없으면 null. */
export function meetingDistanceMetersFromUser(meeting: Meeting, user: LatLng | null): number | null {
  if (!user) return null;
  const lat = meeting.latitude;
  const lng = meeting.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return haversineDistanceMeters(user, { latitude: lat, longitude: lng });
}

/** 목록·칩용 짧은 거리 문자열. */
export function formatDistanceForList(meters: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.max(1, Math.round(meters))}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
