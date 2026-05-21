import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import type { PlaceMasterSummary } from '@/src/lib/places/place-master-api';
import { derivePlaceKey } from '@/src/lib/places/place-key';

export type PlaceLookupInput = {
  placeKey: string;
  placeName?: string;
  roadAddress?: string;
  naverPlaceLink?: string | null;
  /** 레거시 meeting_reviews.place_id(text) · BI용 composite id */
  legacyPlaceId?: string | null;
};

/** DB `places` 행 조회용 후보 키(중복 제거) */
export function buildPlaceLookupKeys(input: PlaceLookupInput): string[] {
  const keys = new Set<string>();
  const pk = input.placeKey.trim();
  if (pk) keys.add(pk);

  const leg = input.legacyPlaceId?.trim();
  if (leg && leg !== pk) keys.add(leg);

  const link = sanitizeNaverLocalPlaceLink(input.naverPlaceLink ?? undefined);
  if (link) keys.add(link);

  const name = input.placeName?.trim() || '';
  const addr = input.roadAddress?.trim() || '';
  if (name && addr) {
    const nameAddrKey = derivePlaceKey({ naverPlaceLink: null, placeName: name, address: addr });
    if (nameAddrKey) keys.add(nameAddrKey);
    if (link) {
      const withLinkKey = derivePlaceKey({ naverPlaceLink: link, placeName: name, address: addr });
      if (withLinkKey) keys.add(withLinkKey);
    }
  }

  return [...keys];
}

/** 동일 장소에 매칭된 여러 마스터 행 중 집계가 가장 큰 행 선택 */
export function pickBestPlaceMaster(rows: Iterable<PlaceMasterSummary>): PlaceMasterSummary | null {
  let best: PlaceMasterSummary | null = null;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    if (row.reviewCount > best.reviewCount) {
      best = row;
      continue;
    }
    if (row.reviewCount === best.reviewCount && row.averageRating > best.averageRating) {
      best = row;
    }
  }
  return best;
}
