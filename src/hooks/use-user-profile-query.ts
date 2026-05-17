import { skipToken, useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useObserveUserProfile } from '@/src/hooks/use-observe-user-profile';
import { PEER_PROFILE_STALE_MS } from '@/src/lib/user-profile-swr';
import { fetchUserProfileAndPersist } from '@/src/lib/user-profile-cache-sync';
import { userProfileQueryKey } from '@/src/lib/user-profile-query-keys';
import { upsertUserProfileToWatermelon } from '@/src/lib/user-profile-watermelon-cache';
import type { UserProfile } from '@/src/lib/user-profile';
import { ensureUserProfile } from '@/src/lib/user-profile';

export type UseUserProfileQueryOptions = {
  refetchOnMount?: boolean | 'always';
  /** true면 `ensureUserProfile`(행 없을 때 생성) 후 fetch */
  ensureMinimal?: boolean;
};

/**
 * 내/타인 프로필 SWR — TanStack Fetch → Watermelon upsert, UI는 observe(네이티브) 또는 query.data(웹).
 */
export function useUserProfileQuery(appUserId: string, opts?: UseUserProfileQueryOptions) {
  const queryClient = useQueryClient();
  const id = typeof appUserId === 'string' ? appUserId.trim() : '';
  const isRestoring = useIsRestoring();
  const cacheLogIdRef = useRef<string | null>(null);
  const { profile: localProfile, hasLocalRow } = useObserveUserProfile(id);
  const useWatermelonUi = Platform.OS !== 'web';

  const query = useQuery({
    queryKey: id ? userProfileQueryKey(id) : userProfileQueryKey('__none'),
    queryFn:
      id.length > 0
        ? async () => {
            if (opts?.ensureMinimal) {
              const ensured = await ensureUserProfile(id);
              await upsertUserProfileToWatermelon(id, ensured);
              return ensured;
            }
            return fetchUserProfileAndPersist(id, queryClient);
          }
        : skipToken,
    staleTime: opts?.refetchOnMount === 'always' ? 0 : PEER_PROFILE_STALE_MS,
    gcTime: 24 * 60 * 60 * 1000,
    enabled: id.length > 0,
    refetchOnMount: opts?.refetchOnMount,
  });

  useEffect(() => {
    cacheLogIdRef.current = null;
  }, [id]);

  useEffect(() => {
    if (isRestoring || !id) return;
    if (cacheLogIdRef.current === id) return;
    const cached = queryClient.getQueryData<UserProfile | null>(userProfileQueryKey(id));
    if (cached !== undefined) {
      cacheLogIdRef.current = id;
      if (useWatermelonUi) {
        void upsertUserProfileToWatermelon(id, cached);
      }
    }
  }, [id, isRestoring, queryClient, useWatermelonUi]);

  const wmHydrating = useWatermelonUi && localProfile === undefined;

  const profile: UserProfile | null = useWatermelonUi
    ? localProfile ?? null
    : query.data !== undefined
      ? query.data
      : null;

  const loadError =
    query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;

  const hasFetched = query.data !== undefined || query.isError;
  const profileReady = useWatermelonUi ? localProfile !== undefined : hasFetched;

  const loading =
    Boolean(id) &&
    !loadError &&
    (wmHydrating || (!hasLocalRow && !hasFetched)) &&
    (query.status === 'pending' || query.fetchStatus === 'fetching' || wmHydrating);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    profile,
    loading,
    loadError,
    refetch,
    profileReady,
    hasLocalRow,
  };
}
