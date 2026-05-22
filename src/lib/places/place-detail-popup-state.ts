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

/** 마스터 미적재 시 모임 만들기 preset 좌표·메타 폴백 */
export type PlaceDetailPopupPlaceSnapshotHint = {
  latitude?: number | null;
  longitude?: number | null;
  category?: string | null;
  preferredPhotoMediaUrl?: string | null;
};

export type PlaceDetailPopupStateOptions = {
  /** 장소 후보 목록·선택 플로우 — 「이 장소로 모임 만들기」 CTA 숨김 */
  suppressCreateMeetingFooter?: boolean;
};

/** 장소 상세 팝업 단일 상태 — `PlaceDetailPopup` 전용 */
export type PlaceDetailPopupState = {
  url: string;
  title: string;
  placeReviewLookup: PlaceLookupInput;
  placeSnapshotHint?: PlaceDetailPopupPlaceSnapshotHint;
  suppressCreateMeetingFooter?: boolean;
};

function snapshotToPlaceSnapshotHint(snapshot: PlaceDetailSnapshot): PlaceDetailPopupPlaceSnapshotHint {
  return {
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    category: snapshot.category,
    preferredPhotoMediaUrl: snapshot.preferredPhotoMediaUrl,
  };
}

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
  options?: PlaceDetailPopupStateOptions,
): PlaceDetailPopupState | null {
  const webUrl = url?.trim() || resolvePlaceDetailWebUrl(snapshot);
  if (!webUrl) return null;
  return {
    ...placeDetailPopupStateFromUrlAndLookup(
      webUrl,
      title ?? snapshot.placeName,
      snapshotToPlaceLookup(snapshot),
    ),
    placeSnapshotHint: snapshotToPlaceSnapshotHint(snapshot),
    ...(options?.suppressCreateMeetingFooter ? { suppressCreateMeetingFooter: true } : {}),
  };
}

export function placeDetailPopupStateFromSearchRow(
  item: PlaceSearchRow,
  url: string,
  title: string,
  options?: PlaceDetailPopupStateOptions,
): PlaceDetailPopupState | null {
  return placeDetailPopupStateFromSnapshot(
    placeDetailSnapshotFromSearchRow(item),
    url,
    title,
    options,
  );
}

export function placeDetailPopupStateFromCandidate(
  candidate: PlaceCandidate,
  url?: string,
  title?: string,
  options?: PlaceDetailPopupStateOptions,
): PlaceDetailPopupState | null {
  return placeDetailPopupStateFromSnapshot(
    placeDetailSnapshotFromCandidate(candidate),
    url,
    title,
    options,
  );
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
  const fromSnap = placeDetailPopupStateFromSnapshot(snap, url, title);
  if (fromSnap) return fromSnap;
  return {
    ...placeDetailPopupStateFromUrlAndLookup(url, title, snapshotToPlaceLookup(snap)),
    placeSnapshotHint: snapshotToPlaceSnapshotHint(snap),
  };
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
