import type { PlaceDetailPopupState } from '@/src/lib/places/place-detail-popup-state';
import { resolvePlaceDetailWebUrl } from '@/src/lib/places/place-detail-popup-state';
import type { FeedSponsoredPlace } from '@/src/lib/promotions/place-promotion-types';

export function placeDetailPopupStateFromSponsoredPlace(
  place: FeedSponsoredPlace,
): PlaceDetailPopupState | null {
  const url =
    resolvePlaceDetailWebUrl({
      placeName: place.placeName,
      roadAddress: place.roadAddress,
      naverPlaceLink: place.naverPlaceLink,
    }) ?? null;
  if (!url) return null;
  return {
    url,
    title: place.placeName.trim() || '장소',
    placeReviewLookup: {
      placeKey: place.placeKey,
      placeName: place.placeName,
      roadAddress: place.roadAddress,
      naverPlaceLink: place.naverPlaceLink,
    },
    placeSnapshotHint: {
      latitude: place.latitude,
      longitude: place.longitude,
      category: place.category,
      preferredPhotoMediaUrl: place.preferredPhotoMediaUrl,
    },
  };
}
