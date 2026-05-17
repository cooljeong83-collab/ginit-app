import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { getPeerUserProfilesForIds, type UserProfile } from '@/src/lib/user-profile';

/**
 * 타인 프로필 맵 — Watermelon 즉시 표시, 5분 stale 시 백그라운드 RPC.
 * `onUpdated`로 display 필드(photoUrl·bio) 변경 시 state 병합.
 */
export function usePeerProfilesMap(peerIds: readonly string[], viewerId?: string): Map<string, UserProfile> {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<Map<string, UserProfile>>(() => new Map());

  const idsKey = useMemo(
    () => [...new Set(peerIds.map((x) => x.trim()).filter(Boolean))].sort().join('\u0001'),
    [peerIds],
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split('\u0001') : [];
    if (ids.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    void getPeerUserProfilesForIds(ids, {
      queryClient,
      viewerId: viewerId?.trim() || undefined,
      onUpdated: (changed) => {
        if (cancelled || changed.size === 0) return;
        setMap((prev) => {
          const next = new Map(prev);
          for (const [k, v] of changed) next.set(k, v);
          return next;
        });
      },
    }).then((loaded) => {
      if (!cancelled) setMap(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey, queryClient, viewerId]);

  return map;
}
