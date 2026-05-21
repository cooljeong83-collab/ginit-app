import {
  buildArrivalVerifyPlaceChips,
  resolveArrivalVerifyConfirmedPlaceChip,
} from '@/src/lib/meeting-arrival-verify-place-summary-data';
import { mapNaverCategoryToReviewCategory } from '@/src/lib/meeting-review/meeting-review-category';
import type { MeetingReviewKeywordCategory } from '@/src/lib/meeting-review/meeting-review-keywords';
import type { Meeting } from '@/src/lib/meetings';
import { meetingPrimaryStartMs } from '@/src/lib/meetings';
import { derivePlaceKey } from '@/src/lib/places/place-key';

export type MeetingReviewPlaceContext = {
  placeName: string;
  /** 네이버 업종 등 */
  category: string | null;
  address: string | null;
  naverPlaceLink: string | null;
  visitDateLabel: string;
  photoUrl: string | null;
  /** BI·preset용 (place_key 또는 레거시 composite) */
  placeId: string;
  /** `places.place_key` */
  placeKey: string;
  latitude: number | null;
  longitude: number | null;
  preferredPhotoMediaUrl: string | null;
  /** 썸네일 검색·표시용 칩 id */
  chipId: string;
  keywordCategory: MeetingReviewKeywordCategory;
};

function formatVisitDateLabel(meeting: Meeting): string {
  const ms = meetingPrimaryStartMs(meeting);
  if (ms != null && Number.isFinite(ms)) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  }
  const sd = meeting.scheduleDate?.trim();
  if (sd) {
    return sd.replace(/-/g, '.');
  }
  return '';
}

function resolvePlaceCandidate(meeting: Meeting) {
  const chips = buildArrivalVerifyPlaceChips(meeting);
  const confirmed = resolveArrivalVerifyConfirmedPlaceChip(meeting, chips);
  if (confirmed) {
    const idx = chips.findIndex((c) => c.id === confirmed.id);
    const raw = meeting.placeCandidates?.[idx >= 0 ? idx : 0] as { placeKey?: string | null } | undefined;
    return { chip: confirmed, placeKey: raw?.placeKey ?? meeting.placeKey ?? null };
  }
  if (chips.length > 0) {
    const raw = meeting.placeCandidates?.[0] as { placeKey?: string | null } | undefined;
    return { chip: chips[0]!, placeKey: raw?.placeKey ?? meeting.placeKey ?? null };
  }
  return {
    chip: {
      id: 'legacy-place',
      title: meeting.placeName?.trim() || meeting.location?.trim() || '장소',
      sub: meeting.address?.trim() || undefined,
    },
    placeKey: meeting.placeKey ?? null,
  };
}

function buildAnalyticsPlaceId(meetingId: string, placeKey: string, chipId: string): string {
  return placeKey || `meeting:${meetingId.trim()}:chip:${chipId.trim()}`;
}

function resolveRawPlaceRow(meeting: Meeting, chipId: string) {
  const chips = buildArrivalVerifyPlaceChips(meeting);
  const idx = chips.findIndex((c) => c.id === chipId);
  return meeting.placeCandidates?.[idx >= 0 ? idx : 0];
}

/**
 * 리뷰 폼 상단(가게명·방문일·사진) 및 제출 스냅샷을 모임 데이터에서 해석합니다.
 */
export function resolveMeetingReviewPlaceContext(meeting: Meeting): MeetingReviewPlaceContext | null {
  const mid = meeting.id?.trim();
  if (!mid) return null;

  const { chip, placeKey: storedKey } = resolvePlaceCandidate(meeting);
  const raw = resolveRawPlaceRow(meeting, chip.id);
  const placeName = chip.title?.trim() || '장소';
  const photoRaw = chip.preferredPhotoMediaUrl?.trim() ?? '';
  const photoUrl = photoRaw.startsWith('https://') ? photoRaw : null;

  const category = chip.category?.trim() || null;
  const address =
    (chip.sub?.trim() || raw?.address?.trim() || meeting.address?.trim() || '').trim() || null;
  const naverPlaceLink = chip.naverPlaceLink?.trim() || raw?.naverPlaceLink?.trim() || null;

  const derivedKey = derivePlaceKey({
    naverPlaceLink,
    placeName,
    address: address ?? '',
  });
  const placeKey = (storedKey?.trim() || derivedKey).trim();

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (raw != null && Number.isFinite(raw.latitude) && Number.isFinite(raw.longitude)) {
    latitude = raw.latitude;
    longitude = raw.longitude;
  } else if (Number.isFinite(meeting.latitude) && Number.isFinite(meeting.longitude)) {
    latitude = meeting.latitude as number;
    longitude = meeting.longitude as number;
  }

  const pref =
    photoUrl ??
    (typeof raw?.preferredPhotoMediaUrl === 'string' && raw.preferredPhotoMediaUrl.startsWith('https://')
      ? raw.preferredPhotoMediaUrl.trim()
      : null);

  return {
    placeName,
    category,
    address,
    naverPlaceLink,
    visitDateLabel: formatVisitDateLabel(meeting),
    photoUrl,
    placeId: buildAnalyticsPlaceId(mid, placeKey, chip.id),
    placeKey,
    latitude,
    longitude,
    preferredPhotoMediaUrl: pref,
    chipId: chip.id,
    keywordCategory: mapNaverCategoryToReviewCategory(chip.category, chip.title),
  };
}
