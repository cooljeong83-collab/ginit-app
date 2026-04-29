/**
 * 서울시 25개 자치구 경계의 축정렬 바운딩박스 (WGS84).
 * 출처: southkorea/seoul-maps (KOSTAT 2013) municipalities GeoJSON 단순화본의 envelope.
 * 지도 화면이 특정 구일 때 해당 구 전체 모임(좌표·주소)을 포함하기 위한 판별용.
 */
import type { LocationGeocodedAddress } from 'expo-location';

import {
  extractGuFromKoreanAddressText,
  guOnlyLabelFromGeocode,
  haystackMatchesFeedRegion,
  normalizeFeedRegionLabel,
} from '@/src/lib/feed-display-location';
import { haversineDistanceMeters, type LatLng } from '@/src/lib/geo-distance';
import type { Meeting } from '@/src/lib/meetings';
import { type SeoulGuLabel, SEOUL_GU_SET } from '@/src/lib/seoul-gu-constants';

export type SeoulGuLatLngBounds = { latMin: number; latMax: number; lngMin: number; lngMax: number };

/** KOSTAT 2013 기준 각 구 polygon envelope */
export const SEOUL_GU_LATLNG_BOUNDS: Record<SeoulGuLabel, SeoulGuLatLngBounds> = {
  강남구: { latMin: 37.45578434878651, latMax: 37.536064291470424, lngMin: 127.01397119667513, lngMax: 127.12441393026374 },
  강동구: { latMin: 37.51415680680291, latMax: 37.57791388161732, lngMin: 127.1116764203608, lngMax: 127.18543378919821 },
  강북구: { latMin: 37.60634705009134, latMax: 37.68228507374621, lngMin: 126.9817452676551, lngMax: 127.05209373568619 },
  강서구: { latMin: 37.52373707805596, latMax: 37.601857300987895, lngMin: 126.76700465024426, lngMax: 126.89184663862764 },
  관악구: { latMin: 37.43315139671158, latMax: 37.49218420958284, lngMin: 126.90156094129895, lngMax: 126.99072073195462 },
  광진구: { latMin: 37.52077294752823, latMax: 37.57076342290955, lngMin: 127.05867359288398, lngMax: 127.11600943681239 },
  구로구: { latMin: 37.47146723936323, latMax: 37.513970034765684, lngMin: 126.81480709048222, lngMax: 126.90531975801812 },
  금천구: { latMin: 37.43100963341445, latMax: 37.48378287831426, lngMin: 126.87553760781829, lngMax: 126.93084408056525 },
  노원구: { latMin: 37.61136014256744, latMax: 37.693602239076704, lngMin: 127.04358800895609, lngMax: 127.1144974746579 },
  도봉구: { latMin: 37.62848931298715, latMax: 37.698589417759045, lngMin: 127.01017954927539, lngMax: 127.05800075220091 },
  동대문구: { latMin: 37.55724769712085, latMax: 37.60654335765868, lngMin: 127.02527254528003, lngMax: 127.08068541280403 },
  동작구: { latMin: 37.472561363278125, latMax: 37.51722500741813, lngMin: 126.90531975801812, lngMax: 126.9871787157338 },
  마포구: { latMin: 37.526617542453366, latMax: 37.588143322880526, lngMin: 126.85950389772532, lngMax: 126.96604189284825 },
  서대문구: { latMin: 37.552310003728124, latMax: 37.60508692737045, lngMin: 126.90370105002282, lngMax: 126.97169209525231 },
  서초구: { latMin: 37.42574929824175, latMax: 37.52503988289669, lngMin: 126.98223807916081, lngMax: 127.09842759318751 },
  성동구: { latMin: 37.52629974922568, latMax: 37.57022476304866, lngMin: 127.01043978345277, lngMax: 127.07580697427795 },
  성북구: { latMin: 37.57524616245249, latMax: 37.63377641288196, lngMin: 126.977175406416, lngMax: 127.07382707099227 },
  송파구: { latMin: 37.46240445587048, latMax: 37.540669955324965, lngMin: 127.06860425556381, lngMax: 127.1634944215765 },
  양천구: { latMin: 37.49965438083505, latMax: 37.54859191094823, lngMin: 126.82389942108053, lngMax: 126.89361739665432 },
  영등포구: { latMin: 37.48218087575429, latMax: 37.547373974997114, lngMin: 126.88156402353862, lngMax: 126.95249990298159 },
  용산구: { latMin: 37.509314966770326, latMax: 37.552184137181925, lngMin: 126.94566733083212, lngMax: 127.02302831890559 },
  은평구: { latMin: 37.573123712282076, latMax: 37.656145979585894, lngMin: 126.88433284773288, lngMax: 126.9738864128702 },
  종로구: { latMin: 37.56313604690827, latMax: 37.62949634786888, lngMin: 126.95145384404022, lngMax: 127.02547266349976 },
  중구: { latMin: 37.54101133407434, latMax: 37.568943552237734, lngMin: 126.96358226710812, lngMax: 127.02881029425372 },
  중랑구: { latMin: 37.566762290300666, latMax: 37.61804244241069, lngMin: 127.07152840437725, lngMax: 127.12048134936907 },
};

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
  const b = SEOUL_GU_LATLNG_BOUNDS[gu];
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
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
