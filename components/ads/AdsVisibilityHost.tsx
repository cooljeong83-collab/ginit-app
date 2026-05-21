import { useEffect } from 'react';

import { useShouldShowAds } from '@/src/hooks/use-should-show-ads';
import { setShouldShowAds } from '@/src/lib/ads/ads-visibility-state';
import { preloadAppOpenAd } from '@/src/lib/ads/app-open-ad-service';
import { preloadSettlementInterstitial } from '@/src/lib/ads/settlement-interstitial-service';

/** 로그인 사용자 `ad_free_until` → 비React 광고 서비스·preload 게이트 동기화 */
export function AdsVisibilityHost() {
  const { shouldShowAds } = useShouldShowAds();

  useEffect(() => {
    setShouldShowAds(shouldShowAds);
    if (shouldShowAds) {
      preloadAppOpenAd();
      preloadSettlementInterstitial();
    }
  }, [shouldShowAds]);

  return null;
}
