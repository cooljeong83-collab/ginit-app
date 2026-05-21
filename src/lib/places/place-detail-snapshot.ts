import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import type { PlaceSearchRow } from '@/src/lib/naver-local-place-search-text';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import {
  derivePlaceKey,
  derivePlaceKeyFromSearchRow,
  enrichPlaceCandidateWithKey,
} from '@/src/lib/places/place-key';
import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import type { PlaceDetailSnapshot } from '@/src/lib/places/place-detail-types';
type PlaceChipLike = {
  id: string;
  title: string;
  sub?: string;
  category?: string;
  naverPlaceLink?: string;
  preferredPhotoMediaUrl?: string;
};

export function placeDetailSnapshotFromSearchRow(item: PlaceSearchRow): PlaceDetailSnapshot {
  const address = (item.roadAddress || item.address || '').trim();
  const link = sanitizeNaverLocalPlaceLink(item.link);
  return {
    placeKey: derivePlaceKeyFromSearchRow({
      title: item.title,
      link: item.link,
      roadAddress: item.roadAddress,
      address: item.address,
    }),
    placeName: item.title.trim() || '장소',
    roadAddress: address,
    category: item.category?.trim() || null,
    naverPlaceLink: link,
    preferredPhotoMediaUrl:
      typeof item.thumbnailUrl === 'string' && item.thumbnailUrl.startsWith('https://')
        ? item.thumbnailUrl.trim()
        : null,
    latitude: Number.isFinite(item.latitude) ? item.latitude : null,
    longitude: Number.isFinite(item.longitude) ? item.longitude : null,
  };
}

export function placeDetailSnapshotFromReviewContext(
  place: MeetingReviewPlaceContext,
): PlaceDetailSnapshot {
  const legacyPlaceId =
    place.placeId.trim() && place.placeId.trim() !== place.placeKey.trim()
      ? place.placeId.trim()
      : null;
  return {
    placeKey: place.placeKey,
    placeName: place.placeName,
    roadAddress: place.address?.trim() || '',
    category: place.category,
    naverPlaceLink: place.naverPlaceLink,
    preferredPhotoMediaUrl: place.preferredPhotoMediaUrl ?? place.photoUrl,
    latitude: place.latitude,
    longitude: place.longitude,
    legacyPlaceId,
  };
}

export function placeDetailSnapshotFromCandidate(candidate: PlaceCandidate): PlaceDetailSnapshot {
  const c = enrichPlaceCandidateWithKey(candidate);
  return {
    placeKey: c.placeKey ?? derivePlaceKey({ naverPlaceLink: c.naverPlaceLink, placeName: c.placeName, address: c.address }),
    placeName: c.placeName,
    roadAddress: c.address,
    category: c.category?.trim() || null,
    naverPlaceLink: c.naverPlaceLink ?? null,
    preferredPhotoMediaUrl: c.preferredPhotoMediaUrl ?? null,
    latitude: c.latitude,
    longitude: c.longitude,
  };
}

export function placeDetailSnapshotFromChip(
  chip: PlaceChipLike,
  meeting: {
    placeCandidates?: PlaceCandidate[] | null;
    address?: string | null;
    latitude?: number;
    longitude?: number;
  },
  placeKey: string,
): PlaceDetailSnapshot {
  const idx = meeting.placeCandidates?.findIndex((p) => {
    const pid = typeof p.id === 'string' ? p.id.trim() : '';
    return pid === chip.id || `pc-${meeting.placeCandidates!.indexOf(p)}` === chip.id;
  });
  const raw = idx != null && idx >= 0 ? meeting.placeCandidates?.[idx] : undefined;
  if (raw) {
    const fromCand = placeDetailSnapshotFromCandidate(raw);
    return { ...fromCand, placeKey: placeKey || fromCand.placeKey };
  }
  return {
    placeKey,
    placeName: chip.title.trim() || '장소',
    roadAddress: chip.sub?.trim() || meeting.address?.trim() || '',
    category: chip.category?.trim() || null,
    naverPlaceLink: chip.naverPlaceLink ?? null,
    preferredPhotoMediaUrl: chip.preferredPhotoMediaUrl ?? null,
    latitude: Number.isFinite(meeting.latitude) ? (meeting.latitude as number) : null,
    longitude: Number.isFinite(meeting.longitude) ? (meeting.longitude as number) : null,
  };
}
