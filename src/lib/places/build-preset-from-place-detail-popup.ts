import { newId } from '@/src/lib/meeting-create-vote-candidates-utils';
import type { PresetPlaceCandidateForCreate } from '@/src/lib/meeting-place-bridge';
import { buildAnalyticsPlaceIdForStorePromo } from '@/src/lib/meeting-preset-place-create-attribution';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import { fetchPlaceMasterByLookup } from '@/src/lib/places/place-master-api';
import type { PlaceLookupInput } from '@/src/lib/places/place-lookup-keys';
import type { PlaceDetailPopupPlaceSnapshotHint } from '@/src/lib/places/place-detail-popup-state';
import {
  fetchPlacePromotionsByKeys,
  pickPlacePromotion,
} from '@/src/lib/promotions/place-promotions-api';
import type { PlacePromotionSummary } from '@/src/lib/promotions/place-promotion-types';

export async function buildPresetPlaceCandidateFromPlaceDetailPopup(
  lookup: PlaceLookupInput,
  intentId: string,
  snapshotHint?: PlaceDetailPopupPlaceSnapshotHint | null,
): Promise<PresetPlaceCandidateForCreate | null> {
  const placeKey = lookup.placeKey.trim();
  const [master, promoMap] = await Promise.all([
    fetchPlaceMasterByLookup(lookup),
    fetchPlacePromotionsByKeys(placeKey ? [placeKey] : []),
  ]);
  const promo = pickPlacePromotion(promoMap, placeKey);

  const hintLat = snapshotHint?.latitude;
  const hintLng = snapshotHint?.longitude;
  const lat =
    master?.latitude ??
    (Number.isFinite(hintLat) ? (hintLat as number) : null);
  const lng =
    master?.longitude ??
    (Number.isFinite(hintLng) ? (hintLng as number) : null);
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const placeName = lookup.placeName?.trim() || master?.placeName.trim() || '장소';
  const address = lookup.roadAddress?.trim() || master?.roadAddress.trim() || '';
  const nl =
    sanitizeNaverLocalPlaceLink(lookup.naverPlaceLink ?? undefined) ??
    sanitizeNaverLocalPlaceLink(master?.naverPlaceLink ?? undefined);
  const hintPref = snapshotHint?.preferredPhotoMediaUrl?.trim();
  const pref =
    (master?.preferredPhotoMediaUrl?.trim().startsWith('https://')
      ? master.preferredPhotoMediaUrl.trim()
      : undefined) ??
    (hintPref?.startsWith('https://') ? hintPref : undefined);
  const category =
    master?.category?.trim() || snapshotHint?.category?.trim() || undefined;

  const attribution = buildPlaceDetailPopupAttribution(intentId, placeKey, promo);
  if (!attribution) return null;

  return {
    id: newId('place'),
    placeName,
    address,
    latitude: lat,
    longitude: lng,
    ...(category ? { category } : {}),
    ...(nl ? { naverPlaceLink: nl } : {}),
    ...(pref ? { preferredPhotoMediaUrl: pref } : {}),
    placeKey: placeKey || master?.placeKey || '',
    attribution,
  };
}

function buildPlaceDetailPopupAttribution(
  intentId: string,
  placeKey: string,
  promo: PlacePromotionSummary | null,
) {
  const pk = placeKey.trim();
  const campaignId = promo?.isSponsored === true ? promo.campaignId.trim() : '';
  const analyticsPlaceId = buildAnalyticsPlaceIdForStorePromo({
    campaignId,
    placeKey: pk,
  });
  if (!analyticsPlaceId) return null;

  return {
    intentId,
    entrySource: 'store_promo' as const,
    analyticsPlaceId,
    entryContext: {
      campaignId,
      placeKey: pk || null,
    },
  };
}
