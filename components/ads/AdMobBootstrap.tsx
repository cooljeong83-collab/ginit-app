import { useEffect } from 'react';
import { Platform } from 'react-native';
import mobileAds from 'react-native-google-mobile-ads';

import { preloadAppOpenAd } from '@/src/lib/ads/app-open-ad-service';
import { preloadSettlementInterstitial } from '@/src/lib/ads/settlement-interstitial-service';

let didInit = false;

/**
 * 앱 최상단: Google Mobile Ads SDK 초기화 + 전면·앱오프닝 프리로드.
 */
export function AdMobBootstrap() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (didInit) {
      preloadAppOpenAd();
      preloadSettlementInterstitial();
      return;
    }
    didInit = true;
    void mobileAds()
      .initialize()
      .then(() => {
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
