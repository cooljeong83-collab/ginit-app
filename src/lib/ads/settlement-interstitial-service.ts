import { Platform } from 'react-native';
import { AdEventType, InterstitialAd } from 'react-native-google-mobile-ads';

import { getShouldShowAds } from '@/src/lib/ads/ads-visibility-state';
import { AD_UNIT_IDS } from '@/src/constants/adsConfig';

let interstitial: InterstitialAd | null = null;
let isLoaded = false;

function isAdsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function getOrCreateInterstitial(): InterstitialAd | null {
  if (!isAdsSupported()) return null;
  if (!interstitial) {
    interstitial = InterstitialAd.createForAdRequest(AD_UNIT_IDS.interstitial);
    interstitial.addAdEventListener(AdEventType.LOADED, () => {
      isLoaded = true;
    });
    interstitial.addAdEventListener(AdEventType.ERROR, () => {
      isLoaded = false;
      try {
        interstitial?.load();
      } catch {
        /* noop */
      }
    });
    interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      isLoaded = false;
      try {
        interstitial?.load();
      } catch {
        /* noop */
      }
    });
  }
  return interstitial;
}

export function preloadSettlementInterstitial(): void {
  if (!getShouldShowAds() || !isAdsSupported()) return;
  const ad = getOrCreateInterstitial();
  if (!ad || isLoaded) return;
  try {
    ad.load();
  } catch {
    /* noop */
  }
}

/** 정산 완료 직후: 표시 가능하면 전면 광고, 닫힘·실패 시 즉시 onDone */
export function showSettlementInterstitial(onDone: () => void): void {
  if (!getShouldShowAds() || !isAdsSupported()) {
    onDone();
    return;
  }
  const ad = getOrCreateInterstitial();
  if (!ad) {
    onDone();
    return;
  }

  const finish = () => {
    onDone();
  };

  if (!isLoaded) {
    preloadSettlementInterstitial();
    finish();
    return;
  }

  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    finish();
  };

  const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, done);
  const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
    unsubClosed();
    done();
  });

  try {
    ad.show();
  } catch {
    unsubClosed();
    unsubError();
    done();
  }
}
