import { newId } from '@/src/lib/meeting-create-vote-candidates-utils';
import type { PresetPlaceCandidateForCreate } from '@/src/lib/meeting-place-bridge';
import type { FeedSponsoredPlace } from '@/src/lib/promotions/place-promotion-types';
import { buildAnalyticsPlaceIdForStorePromo } from '@/src/lib/meeting-preset-place-create-attribution';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';

export function buildPresetPlaceCandidateFromSponsoredPlace(
  place: FeedSponsoredPlace,
  intentId: string,
): PresetPlaceCandidateForCreate | null {
  const lat = place.latitude;
  const lng = place.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const placeName = place.placeName.trim() || '장소';
  const address = place.roadAddress.trim();
  const nl = sanitizeNaverLocalPlaceLink(place.naverPlaceLink ?? undefined);
  const pref =
    place.preferredPhotoMediaUrl?.trim().startsWith('https://')
      ? place.preferredPhotoMediaUrl.trim()
      : undefined;

  const analyticsPlaceId = buildAnalyticsPlaceIdForStorePromo({
    campaignId: place.campaignId,
    placeKey: place.placeKey,
  });
  if (!analyticsPlaceId) return null;

  return {
    id: newId('place'),
    placeName,
    address,
    latitude: lat,
    longitude: lng,
    ...(place.category ? { category: place.category } : {}),
    ...(nl ? { naverPlaceLink: nl } : {}),
    ...(pref ? { preferredPhotoMediaUrl: pref } : {}),
    placeKey: place.placeKey,
    attribution: {
      intentId,
      entrySource: 'store_promo',
      analyticsPlaceId,
      entryContext: {
        campaignId: place.campaignId,
        placeKey: place.placeKey,
      },
    },
  };
}
