import {
  buildArrivalVerifyPlaceChips,
  resolveArrivalVerifyConfirmedPlaceChip,
} from '@/src/lib/meeting-arrival-verify-place-summary-data';
import { newId } from '@/src/lib/meeting-create-vote-candidates-utils';
import type { PresetPlaceCandidateForCreate } from '@/src/lib/meeting-place-bridge';
import { buildMeetingReviewSummaryAttribution } from '@/src/lib/meeting-preset-place-create-attribution';
import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import type { Meeting } from '@/src/lib/meetings';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import { derivePlaceKey } from '@/src/lib/places/place-key';

function resolveRawPlaceRow(meeting: Meeting, chipId: string) {
  const chips = buildArrivalVerifyPlaceChips(meeting);
  const idx = chips.findIndex((c) => c.id === chipId);
  return meeting.placeCandidates?.[idx >= 0 ? idx : 0];
}

/**
 * 모임 후기 써머리 → 선택장소 preset (좌표 없으면 null).
 */
export function buildPresetPlaceCandidateFromReviewSummary(
  meeting: Meeting,
  place: MeetingReviewPlaceContext,
  intentId: string,
): PresetPlaceCandidateForCreate | null {
  const mid = meeting.id?.trim();
  if (!mid) return null;

  const chips = buildArrivalVerifyPlaceChips(meeting);
  const confirmed = resolveArrivalVerifyConfirmedPlaceChip(meeting, chips);
  const chip = confirmed ?? chips[0];
  if (!chip) return null;

  const raw = resolveRawPlaceRow(meeting, chip.id);
  const placeName = (raw?.placeName ?? chip.title ?? place.placeName).trim() || '장소';
  const address =
    (raw?.address ?? place.address ?? chip.sub ?? '').trim() ||
    meeting.address?.trim() ||
    '';

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (raw != null && Number.isFinite(raw.latitude) && Number.isFinite(raw.longitude)) {
    latitude = raw.latitude;
    longitude = raw.longitude;
  } else {
    const mlat = meeting.latitude;
    const mlng = meeting.longitude;
    if (Number.isFinite(mlat) && Number.isFinite(mlng)) {
      latitude = mlat as number;
      longitude = mlng as number;
    }
  }
  if (latitude == null || longitude == null) return null;

  const cat = (raw?.category ?? chip.category ?? place.category ?? '').trim();
  const nl =
    sanitizeNaverLocalPlaceLink(raw?.naverPlaceLink ?? undefined) ??
    sanitizeNaverLocalPlaceLink(chip.naverPlaceLink ?? undefined) ??
    sanitizeNaverLocalPlaceLink(place.naverPlaceLink ?? undefined);
  const prefRaw = (raw?.preferredPhotoMediaUrl ?? chip.preferredPhotoMediaUrl ?? place.photoUrl ?? '').trim();
  const preferredPhotoMediaUrl = prefRaw.startsWith('https://') ? prefRaw : undefined;
  const placeKey = derivePlaceKey({
    naverPlaceLink: nl,
    placeName,
    address,
  });

  const attribution = buildMeetingReviewSummaryAttribution(intentId, place.placeId, {
    sourceMeetingId: mid,
    sourcePlaceId: place.placeId,
    sourceChipId: place.chipId,
  });

  return {
    id: newId('place'),
    placeName,
    address,
    latitude,
    longitude,
    ...(cat ? { category: cat } : {}),
    ...(nl ? { naverPlaceLink: nl } : {}),
    ...(preferredPhotoMediaUrl ? { preferredPhotoMediaUrl } : {}),
    placeKey,
    attribution,
  };
}
