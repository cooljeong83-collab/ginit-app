import { derivePlaceKeyFromSearchRow } from '@/src/lib/places/place-key';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';

export type PlaceSearchSyncPayloadRow = {
  place_key: string;
  place_name: string;
  road_address: string;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  naver_place_link: string | null;
  preferred_photo_media_url: string | null;
};

export function placeSearchRowToSyncPayload(row: PlaceSearchRow): PlaceSearchSyncPayloadRow | null {
  const placeName = row.title.trim();
  const roadAddress = (row.roadAddress || row.address || '').trim();
  if (!placeName || !roadAddress) return null;

  const placeKey = derivePlaceKeyFromSearchRow({
    title: row.title,
    link: row.link,
    roadAddress: row.roadAddress,
    address: row.address,
  });
  if (!placeKey) return null;

  const lat = row.latitude;
  const lng = row.longitude;
  const link = sanitizeNaverLocalPlaceLink(row.link ?? undefined);
  const thumb = row.thumbnailUrl?.trim() || null;

  return {
    place_key: placeKey,
    place_name: placeName,
    road_address: roadAddress,
    latitude: lat != null && Number.isFinite(lat) ? lat : null,
    longitude: lng != null && Number.isFinite(lng) ? lng : null,
    category: row.category?.trim() || null,
    naver_place_link: link ?? null,
    preferred_photo_media_url: thumb,
  };
}

export function buildPlaceSearchSyncPayloads(
  rows: readonly PlaceSearchRow[],
): PlaceSearchSyncPayloadRow[] {
  const seen = new Set<string>();
  const out: PlaceSearchSyncPayloadRow[] = [];
  for (const row of rows) {
    const payload = placeSearchRowToSyncPayload(row);
    if (!payload || seen.has(payload.place_key)) continue;
    seen.add(payload.place_key);
    out.push(payload);
  }
  return out;
}
