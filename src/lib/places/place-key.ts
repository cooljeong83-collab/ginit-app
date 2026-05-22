import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import { sanitizeNaverLocalPlaceLink, stableNaverLocalSearchDedupeKey } from '@/src/lib/naver-local-search';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

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

/**
 * 로컬 캐시(`place-cache:`)·DB·네이버 검색 결과 병합용.
 * `stableNaverLocalSearchDedupeKey`는 네이버 id(`local-…`) 기준이라 소스 간 동일 장소가 겹치지 않습니다.
 */
export function placeSearchRowHybridMergeKey(row: PlaceSearchRow): string {
  const cachePrefix = 'place-cache:';
  if (row.id.startsWith(cachePrefix)) {
    const k = row.id.slice(cachePrefix.length).trim();
    if (k) return k;
  }
  const sponsoredPrefix = 'sponsored:';
  if (row.id.startsWith(sponsoredPrefix)) {
    const k = row.id.slice(sponsoredPrefix.length).trim();
    if (k) return k;
  }
  const pk = derivePlaceKeyFromSearchRow({
    title: row.title,
    link: row.link,
    roadAddress: row.roadAddress,
    address: row.address,
  });
  if (pk) return pk;
  return stableNaverLocalSearchDedupeKey(row);
}
