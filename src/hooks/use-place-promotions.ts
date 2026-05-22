import { useQuery } from '@tanstack/react-query';

import {
  fetchFeedSponsoredPlaces,
  fetchPlacePromotionsByKeys,
  fetchSponsoredPlacesForSearch,
  pickPlacePromotion,
  resolveMeetingPlacePromotion,
  type SponsoredPlaceSearchMeetingContext,
} from '@/src/lib/promotions/place-promotions-api';

export function feedSponsoredPlaceQueryKey(regionNorm: string): readonly ['promotions', 'feed', string] {
  return ['promotions', 'feed', regionNorm.trim()] as const;
}

export function sponsoredPlacesForSearchQueryKey(
  regionNorm: string,
  meetingCtx?: SponsoredPlaceSearchMeetingContext | null,
): readonly ['promotions', 'search-boost', string, string, string, string] {
  const ctx = meetingCtx ?? {};
  return [
    'promotions',
    'search-boost',
    regionNorm.trim(),
    (ctx.categoryId ?? '').trim(),
    (ctx.majorCode ?? '').trim(),
    (ctx.specialtyKind ?? '').trim(),
  ] as const;
}

export function placePromotionsByKeysQueryKey(
  placeKeys: string[],
): readonly ['promotions', 'by-keys', string] {
  const sorted = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))].sort();
  return ['promotions', 'by-keys', sorted.join('|')] as const;
}

export function meetingPlacePromotionQueryKey(
  meetingId: string,
): readonly ['promotions', 'meeting', string] {
  return ['promotions', 'meeting', meetingId.trim()] as const;
}

export function useFeedSponsoredPlace(regionNorm: string | null | undefined, enabled = true) {
  const region = regionNorm?.trim() ?? '';
  return useQuery({
    queryKey: feedSponsoredPlaceQueryKey(region),
    queryFn: async () => {
      const rows = await fetchFeedSponsoredPlaces(region || null, 1);
      return rows[0] ?? null;
    },
    enabled,
    staleTime: 120_000,
  });
}

export function useSponsoredPlacesForSearch(
  regionNorm: string | null | undefined,
  meetingCtx?: SponsoredPlaceSearchMeetingContext | null,
  enabled = true,
) {
  const region = regionNorm?.trim() ?? '';
  return useQuery({
    queryKey: sponsoredPlacesForSearchQueryKey(region, meetingCtx),
    queryFn: () => fetchSponsoredPlacesForSearch(region || null, 3, meetingCtx),
    enabled: enabled && region.length > 0,
    staleTime: 120_000,
  });
}

export function usePlacePromotionsByKeys(placeKeys: string[]) {
  const keys = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))];
  return useQuery({
    queryKey: placePromotionsByKeysQueryKey(keys),
    queryFn: () => fetchPlacePromotionsByKeys(keys),
    enabled: keys.length > 0,
    staleTime: 120_000,
  });
}

export function useMeetingPlacePromotion(meetingId: string | null | undefined, enabled = true) {
  const mid = meetingId?.trim() ?? '';
  return useQuery({
    queryKey: meetingPlacePromotionQueryKey(mid),
    queryFn: () => resolveMeetingPlacePromotion(mid),
    enabled: enabled && mid.length > 0,
    staleTime: 60_000,
  });
}

export { pickPlacePromotion };
