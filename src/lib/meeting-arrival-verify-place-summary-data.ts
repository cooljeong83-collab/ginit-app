import type { NaverPlaceImageSearchFields } from '@/src/lib/naver-image-search';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import type { Meeting } from '@/src/lib/meetings';

/** 모임 상세 `PlaceChip`과 동일 필드 — 장소 인증 상단 요약 전용 */
export type ArrivalVerifyPlaceChip = {
  id: string;
  title: string;
  sub?: string;
  category?: string;
  preferredPhotoMediaUrl?: string;
  naverPlaceLink?: string;
};

function placeCandidateChipId(p: { id?: string }, index: number): string {
  const pid = typeof p.id === 'string' ? p.id.trim() : '';
  return pid || `pc-${index}`;
}

/**
 * `app/meeting/[id].tsx`의 `buildPlaceChipsFromMeeting`과 동일 규칙입니다.
 */
export function buildArrivalVerifyPlaceChips(m: Meeting): ArrivalVerifyPlaceChip[] {
  const list = m.placeCandidates ?? [];
  if (list.length > 0) {
    return list.map((p, i) => {
      const nl = sanitizeNaverLocalPlaceLink(p.naverPlaceLink ?? undefined);
      const cat = typeof p.category === 'string' && p.category.trim() !== '' ? p.category.trim() : '';
      const prefRaw = typeof p.preferredPhotoMediaUrl === 'string' ? p.preferredPhotoMediaUrl.trim() : '';
      const pref = prefRaw.startsWith('https://') ? prefRaw : '';
      return {
        id: placeCandidateChipId(p, i),
        title: p.placeName?.trim() || '장소',
        sub: p.address?.trim() || undefined,
        ...(cat ? { category: cat } : {}),
        ...(pref ? { preferredPhotoMediaUrl: pref } : {}),
        ...(nl ? { naverPlaceLink: nl } : {}),
      };
    });
  }
  const name = m.placeName?.trim() || m.location?.trim();
  const addr = m.address?.trim();
  if (name || addr) {
    return [{ id: 'legacy-place', title: name || '장소', sub: addr || undefined }];
  }
  return [];
}

/**
 * `confirmedPlaceChipResolved`와 동일 규칙입니다.
 */
export function resolveArrivalVerifyConfirmedPlaceChip(
  meeting: Meeting,
  placeChips: ArrivalVerifyPlaceChip[],
): ArrivalVerifyPlaceChip | null {
  if (meeting.scheduleConfirmed !== true || !meeting.confirmedPlaceChipId?.trim()) return null;
  const rawId = meeting.confirmedPlaceChipId.trim();
  return placeChips.find((c) => c.id === rawId) ?? null;
}

export function arrivalVerifyPlaceChipToNaverImageFields(chip: ArrivalVerifyPlaceChip): NaverPlaceImageSearchFields {
  return {
    title: chip.title,
    addressLine: chip.sub,
    category: chip.category,
    preferredPhotoMediaUrl: chip.preferredPhotoMediaUrl,
    kakaoPlaceDetailPageUrl: chip.naverPlaceLink,
  };
}
