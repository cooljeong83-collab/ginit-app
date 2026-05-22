import type { FeedSponsoredPlace } from '@/src/lib/promotions/place-promotion-types';
import { stableNaverLocalSearchDedupeKey } from '@/src/lib/naver-local-place-search-text';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

export function sponsoredPlaceToSearchRow(place: FeedSponsoredPlace): PlaceSearchRow | null {
  const lat = place.latitude;
  const lng = place.longitude;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  const title = place.placeName.trim();
  if (!title) return null;
  const roadAddress = place.roadAddress.trim();
  return {
    id: `sponsored:${place.placeKey}`,
    title,
    address: roadAddress,
    roadAddress,
    category: place.category?.trim() ?? '',
    link: place.naverPlaceLink?.trim() || undefined,
    latitude: lat,
    longitude: lng,
    thumbnailUrl: place.preferredPhotoMediaUrl?.trim() || null,
    isSponsoredPromotion: true,
    promotionId: place.promotionId,
  };
}

export function mergeSponsoredIntoPlaceSearchRows(args: {
  prevRows: PlaceSearchRow[];
  naverRows: PlaceSearchRow[];
  sponsoredRows: PlaceSearchRow[];
  selectedById: Record<string, { placeName: string; address: string }>;
}): PlaceSearchRow[] {
  const { prevRows, naverRows, sponsoredRows, selectedById } = args;
  const out: PlaceSearchRow[] = [];
  const seen = new Set<string>();

  const appendOnce = (row: PlaceSearchRow) => {
    const key = stableNaverLocalSearchDedupeKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };

  const mergeRowFields = (existing: PlaceSearchRow, incoming: PlaceSearchRow): PlaceSearchRow => {
    const thumb =
      isUsableRemoteImageUrl(existing.thumbnailUrl) && !isUsableRemoteImageUrl(incoming.thumbnailUrl)
        ? existing.thumbnailUrl
        : incoming.thumbnailUrl ?? existing.thumbnailUrl;
    return {
      ...incoming,
      thumbnailUrl: thumb ?? null,
      isSponsoredPromotion: existing.isSponsoredPromotion || incoming.isSponsoredPromotion,
      promotionId: existing.promotionId ?? incoming.promotionId,
    };
  };

  const appendOrMerge = (row: PlaceSearchRow) => {
    const key = stableNaverLocalSearchDedupeKey(row);
    const idx = out.findIndex((r) => stableNaverLocalSearchDedupeKey(r) === key);
    if (idx >= 0) {
      out[idx] = mergeRowFields(out[idx]!, row);
      return;
    }
    seen.add(key);
    out.push(row);
  };

  prevRows.forEach((row) => {
    if (selectedById[row.id]) appendOnce(row);
  });

  sponsoredRows.forEach(appendOrMerge);

  naverRows.forEach((row) => {
    const key = stableNaverLocalSearchDedupeKey(row);
    if (seen.has(key)) {
      const idx = out.findIndex((r) => stableNaverLocalSearchDedupeKey(r) === key);
      if (idx >= 0) out[idx] = mergeRowFields(out[idx]!, row);
      return;
    }
    appendOnce(row);
  });

  return out;
}

function isUsableRemoteImageUrl(raw: string | null | undefined): raw is string {
  const t = raw?.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
