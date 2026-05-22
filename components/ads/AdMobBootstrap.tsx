import { useEffect } from 'react';
import { Platform } from 'react-native';
import { preloadAppOpenAd } from '@/src/lib/ads/app-open-ad-service';
import { ensureMobileAdsInitialized } from '@/src/lib/ads/mobile-ads-init';
import { preloadSettlementInterstitial } from '@/src/lib/ads/settlement-interstitial-service';

let didPreload = false;

/**
 * 앱 최상단: Google Mobile Ads SDK 초기화 + 전면·앱오프닝 프리로드.
 */
export function AdMobBootstrap() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void ensureMobileAdsInitialized()
      .then(() => {
        if (didPreload) return;
        didPreload = true;
        preloadAppOpenAd();
        preloadSettlementInterstitial();
      })
      .catch((e: unknown) => {
        if (__DEV__) {
          console.warn('[AdMobBootstrap] initialize failed', e);
        }
      });
  }, []);

  return null;
}
