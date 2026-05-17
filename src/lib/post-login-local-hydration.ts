import type { QueryClient } from '@tanstack/react-query';

import { pullFeedInterestRegionsFromServerOnLogin } from '@/src/lib/feed-registered-regions';
import { fetchUserProfileAndPersist } from '@/src/lib/user-profile-cache-sync';

/**
 * 재로그인·계정 전환 직후 — 서버 백업 데이터를 로컬에 우선 복원합니다.
 * (관심 지역 AsyncStorage, 본인 프로필 Watermelon + TanStack)
 */
export async function runPostLoginLocalHydration(
  appUserId: string,
  queryClient: QueryClient,
): Promise<void> {
  const pk = appUserId.trim();
  if (!pk) return;
  await Promise.allSettled([
    pullFeedInterestRegionsFromServerOnLogin(pk),
    fetchUserProfileAndPersist(pk, queryClient),
  ]);
}
