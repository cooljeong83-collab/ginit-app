import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';

/** 장소 마스터 `places.place_key` — 네이버 링크 우선, 없으면 상호명+주소(공백 제거) 조합 */
export function derivePlaceKey(input: {
  naverPlaceLink?: string | null;
  placeName: string;
  address: string;
}): string {
  const link = input.naverPlaceLink?.trim();
  if (link) return link;
  const name = input.placeName.replace(/\s/g, '');
  const addr = input.address.replace(/\s/g, '');
  return `${name}_${addr}`;
}

export function enrichPlaceCandidateWithKey(candidate: PlaceCandidate): PlaceCandidate {
  const link = sanitizeNaverLocalPlaceLink(candidate.naverPlaceLink ?? undefined);
  return {
    ...candidate,
    placeKey: derivePlaceKey({
      naverPlaceLink: link,
      placeName: candidate.placeName,
      address: candidate.address,
    }),
    ...(link ? { naverPlaceLink: link } : {}),
  };
}

export function derivePlaceKeyFromSearchRow(input: {
  title: string;
  link?: string | null;
  roadAddress?: string | null;
  address?: string | null;
}): string {
  const addr = (input.roadAddress ?? input.address ?? '').trim();
  const link = sanitizeNaverLocalPlaceLink(input.link ?? undefined);
  return derivePlaceKey({
    naverPlaceLink: link,
    placeName: input.title.trim() || '장소',
    address: addr,
  });
}
