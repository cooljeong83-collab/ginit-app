import { useMemo } from 'react';

import { useUserSession } from '@/src/context/UserSessionContext';
import { isProfileAdFree } from '@/src/lib/ads/is-profile-ad-free';
import { useUserProfileQuery } from '@/src/hooks/use-user-profile-query';

export function useShouldShowAds() {
  const { userId } = useUserSession();
  const id = userId?.trim() ?? '';
  const { profile, profileReady } = useUserProfileQuery(id);

  const isAdFree = useMemo(() => isProfileAdFree(profile), [profile]);

  const shouldShowAds = useMemo(() => {
    if (!id) return true;
    // 프로필 로딩 중에 false면 피드에 광고 행 자체가 안 들어감 — 로드 완료 후 재계산 전까지 빈 목록처럼 보임
    if (!profileReady) return true;
    return !isAdFree;
  }, [id, profileReady, isAdFree]);

  return { shouldShowAds, profileReady, isAdFree, userId: id || null };
}
