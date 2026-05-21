import {
  resolveNaverPlaceDetailWebUrlLikeVoteChip,
  resolveNaverPlacePageUrlFromLinkField,
} from '@/src/lib/naver-local-search';
import type { Meeting } from '@/src/lib/meetings';
import { resolveMeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import { derivePlaceKey } from '@/src/lib/places/place-key';
import type { PlaceLookupInput } from '@/src/lib/places/place-lookup-keys';
import {
  placeDetailSnapshotFromCandidate,
  placeDetailSnapshotFromChip,
  placeDetailSnapshotFromReviewContext,
  placeDetailSnapshotFromSearchRow,
} from '@/src/lib/places/place-detail-snapshot';
import type { PlaceDetailSnapshot } from '@/src/lib/places/place-detail-types';
import type { PlaceSearchRow } from '@/src/lib/naver-local-place-search-text';
import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';

/** 장소 상세 팝업 단일 상태 — `PlaceDetailPopup` 전용 */
export type PlaceDetailPopupState = {
  url: string;
  title: string;
  placeReviewLookup: PlaceLookupInput;
};

export function snapshotToPlaceLookup(snapshot: PlaceDetailSnapshot): PlaceLookupInput {
  return {
    placeKey: snapshot.placeKey,
    placeName: snapshot.placeName,
    roadAddress: snapshot.roadAddress,
    naverPlaceLink: snapshot.naverPlaceLink,
    legacyPlaceId: snapshot.legacyPlaceId,
  };
}

export function resolvePlaceDetailWebUrl(input: {
  placeName: string;
  roadAddress?: string | null;
  naverPlaceLink?: string | null;
}): string | null {
  return (
    resolveNaverPlacePageUrlFromLinkField(input.naverPlaceLink) ??
    resolveNaverPlaceDetailWebUrlLikeVoteChip({
      naverPlaceLink: input.naverPlaceLink ?? undefined,
      title: input.placeName,
      addressLine: input.roadAddress?.trim() || undefined,
    })
  );
}

export function placeDetailPopupStateFromUrlAndLookup(
  url: string,
  title: string,
  lookup: PlaceLookupInput,
): PlaceDetailPopupState {
  return {
    url: url.trim(),
    title: title.trim() || lookup.placeName?.trim() || '장소',
    placeReviewLookup: lookup,
  };
}

export function placeDetailPopupStateFromSnapshot(
  snapshot: PlaceDetailSnapshot,
  url?: string,
  title?: string,
): PlaceDetailPopupState | null {
  const webUrl = url?.trim() || resolvePlaceDetailWebUrl(snapshot);
  if (!webUrl) return null;
  return placeDetailPopupStateFromUrlAndLookup(
    webUrl,
    title ?? snapshot.placeName,
    snapshotToPlaceLookup(snapshot),
  );
}

export function placeDetailPopupStateFromSearchRow(
  item: PlaceSearchRow,
  url: string,
  title: string,
): PlaceDetailPopupState | null {
  return placeDetailPopupStateFromSnapshot(placeDetailSnapshotFromSearchRow(item), url, title);
}

export function placeDetailPopupStateFromCandidate(
  candidate: PlaceCandidate,
  url?: string,
  title?: string,
): PlaceDetailPopupState | null {
  return placeDetailPopupStateFromSnapshot(placeDetailSnapshotFromCandidate(candidate), url, title);
}

export function placeDetailPopupStateFromMeetingChip(
  meeting: Meeting,
  chip: {
    id: string;
    title: string;
    sub?: string;
    category?: string;
    naverPlaceLink?: string;
  },
  url: string,
  title: string,
): PlaceDetailPopupState {
  const snap = placeDetailSnapshotFromChip(
    chip,
    {
      placeCandidates: meeting.placeCandidates ?? undefined,
      address: meeting.address,
      latitude: meeting.latitude,
      longitude: meeting.longitude,
    },
    derivePlaceKey({
      naverPlaceLink: chip.naverPlaceLink,
      placeName: chip.title,
      address: chip.sub ?? meeting.address ?? '',
    }),
  );
  return (
    placeDetailPopupStateFromSnapshot(snap, url, title) ??
    placeDetailPopupStateFromUrlAndLookup(url, title, snapshotToPlaceLookup(snap))
  );
}

export function placeDetailPopupStateFromMeeting(
  meeting: Meeting,
  url: string,
  title: string,
): PlaceDetailPopupState | null {
  const ctx = resolveMeetingReviewPlaceContext(meeting);
  if (ctx) {
    return placeDetailPopupStateFromSnapshot(
      placeDetailSnapshotFromReviewContext(ctx),
      url,
      title,
    );
  }
  const placeName = meeting.placeName?.trim() || title.trim() || '장소';
  const roadAddress = meeting.address?.trim() || '';
  const placeKey = derivePlaceKey({ naverPlaceLink: null, placeName, address: roadAddress });
  if (!url.trim()) return null;
  return placeDetailPopupStateFromUrlAndLookup(url, title, {
    placeKey,
    placeName,
    roadAddress,
    naverPlaceLink: null,
  });
}
