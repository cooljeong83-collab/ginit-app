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
    if (!profileReady) return false;
    return !isAdFree;
  }, [id, profileReady, isAdFree]);

  return { shouldShowAds, profileReady, isAdFree, userId: id || null };
}
