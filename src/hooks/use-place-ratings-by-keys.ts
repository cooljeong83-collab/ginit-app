import { useQuery } from '@tanstack/react-query';

import { fetchPlacesByKeys, type PlaceMasterSummary } from '@/src/lib/places/place-master-api';

export function placeRatingsQueryKey(placeKeys: string[]): readonly ['places', 'ratings', string] {
  const sorted = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))].sort();
  return ['places', 'ratings', sorted.join('|')] as const;
}

export function usePlaceRatingsByKeys(placeKeys: string[]) {
  const keys = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))];
  return useQuery({
    queryKey: placeRatingsQueryKey(keys),
    queryFn: () => fetchPlacesByKeys(keys),
    enabled: keys.length > 0,
    staleTime: 60_000,
  });
}

export function pickPlaceRating(
  map: Map<string, PlaceMasterSummary> | undefined,
  placeKey: string,
): PlaceMasterSummary | null {
  if (!map || !placeKey.trim()) return null;
  return map.get(placeKey.trim()) ?? null;
}
