import type { PlaceKeywordStat } from '@/src/lib/places/place-master-api';

/** 장소 상세 모달·배지 공통 스냅샷 */
export type PlaceDetailSnapshot = {
  placeKey: string;
  placeName: string;
  roadAddress: string;
  category?: string | null;
  naverPlaceLink?: string | null;
  preferredPhotoMediaUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  averageRating?: number;
  reviewCount?: number;
  topKeywords?: PlaceKeywordStat[];
  /** 레거시 text place_id · `meeting:…:chip:…` 등 DB place_key 별칭 */
  legacyPlaceId?: string | null;
};
