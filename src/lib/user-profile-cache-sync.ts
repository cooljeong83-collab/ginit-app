import type { QueryClient } from '@tanstack/react-query';

import { userProfileQueryKey } from '@/src/lib/user-profile-query-keys';
import { upsertUserProfileToWatermelon } from '@/src/lib/user-profile-watermelon-cache';
import type { UserProfile } from '@/src/lib/user-profile';
import { fetchUserProfileFromServer } from '@/src/lib/user-profile';

/** 서버 Pull + Watermelon upsert + TanStack 캐시 동기화. */
export async function fetchUserProfileAndPersist(
  appUserId: string,
  queryClient?: QueryClient,
): Promise<UserProfile | null> {
  const id = appUserId.trim();
  if (!id) return null;
  const profile = await fetchUserProfileFromServer(id);
  if (profile) {
    await upsertUserProfileToWatermelon(id, profile);
    queryClient?.setQueryData(userProfileQueryKey(id), profile);
  } else {
    queryClient?.setQueryData(userProfileQueryKey(id), null);
  }
  return profile;
}

export function prefetchUserProfileCache(
  queryClient: QueryClient,
  appUserId: string,
): Promise<UserProfile | null | undefined> {
  const id = appUserId.trim();
  if (!id) return Promise.resolve(undefined);
  return queryClient.prefetchQuery({
    queryKey: userProfileQueryKey(id),
    queryFn: () => fetchUserProfileAndPersist(id, queryClient),
  });
}
