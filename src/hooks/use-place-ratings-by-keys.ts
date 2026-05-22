import { useQuery } from '@tanstack/react-query';

import {
  fetchPlacesByKeys,
  type PlaceMasterSummary,
} from '@/src/lib/places/place-master-api';
import { scheduleSyncSearchRowsToPlaceMaster } from '@/src/lib/places/place-search-sync';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

export function placeRatingsQueryKey(placeKeys: string[]): readonly ['places', 'ratings', string] {
  const sorted = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))].sort();
  return ['places', 'ratings', sorted.join('|')] as const;
}

export function usePlaceRatingsByKeys(
  placeKeys: string[],
  options?: { syncRows?: readonly PlaceSearchRow[]; enabled?: boolean },
) {
  const keys = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))];
  const syncRows = options?.syncRows;

  return useQuery({
    queryKey: placeRatingsQueryKey(keys),
    queryFn: async () => {
      if (syncRows && syncRows.length > 0) {
        scheduleSyncSearchRowsToPlaceMaster(syncRows);
      }
      return fetchPlacesByKeys(keys);
    },
    enabled: (options?.enabled ?? true) && keys.length > 0,
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
