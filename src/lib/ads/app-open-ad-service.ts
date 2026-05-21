import { AppState, Platform, type AppStateStatus } from 'react-native';
import { AdEventType, AppOpenAd } from 'react-native-google-mobile-ads';

import { getShouldShowAds } from '@/src/lib/ads/ads-visibility-state';
import { AD_UNIT_IDS, APP_OPEN_AD_ENABLED } from '@/src/constants/adsConfig';

function isAppOpenAdFeatureOn(): boolean {
  return APP_OPEN_AD_ENABLED && getShouldShowAds();
}

const COLD_START_TIMEOUT_MS = 2500;
const FOREGROUND_COOLDOWN_MS = 60_000;

let appOpenAd: AppOpenAd | null = null;
let isLoaded = false;
let isShowing = false;
let lastForegroundShowAt = 0;

function isAdsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function getOrCreateAd(): AppOpenAd | null {
  if (!isAdsSupported()) return null;
  if (!appOpenAd) {
    appOpenAd = AppOpenAd.createForAdRequest(AD_UNIT_IDS.appOpen);
    appOpenAd.addAdEventListener(AdEventType.LOADED, () => {
      isLoaded = true;
    });
    appOpenAd.addAdEventListener(AdEventType.ERROR, () => {
      isLoaded = false;
      isShowing = false;
      try {
        appOpenAd?.load();
      } catch {
        /* noop */
      }
    });
    appOpenAd.addAdEventListener(AdEventType.CLOSED, () => {
      isLoaded = false;
      isShowing = false;
      try {
        appOpenAd?.load();
      } catch {
        /* noop */
      }
    });
  }
  return appOpenAd;
}

/** SDK 초기화 직후 호출 — 백그라운드 프리로드 */
export function preloadAppOpenAd(): void {
  if (!isAppOpenAdFeatureOn() || !isAdsSupported()) return;
  const ad = getOrCreateAd();
  if (!ad || isLoaded || isShowing) return;
  try {
    ad.load();
  } catch {
    /* noop */
  }
}

function showLoadedAd(): Promise<void> {
  return new Promise((resolve) => {
    const ad = getOrCreateAd();
    if (!ad || !isLoaded || isShowing) {
      resolve();
      return;
    }
    isShowing = true;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      isShowing = false;
      resolve();
    };
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, finish);
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      unsubClosed();
      finish();
    });
    try {
      ad.show();
    } catch {
      unsubClosed();
      unsubError();
      finish();
    }
  });
}

/**
 * 콜드 스타트(스플래시 → 탭): 로드됐으면 표시, 아니면 타임아웃 후 진행.
 */
export async function tryShowColdStartAppOpenAd(timeoutMs = COLD_START_TIMEOUT_MS): Promise<void> {
  if (!isAppOpenAdFeatureOn() || !isAdsSupported()) return;
  preloadAppOpenAd();
  if (isLoaded) {
    await showLoadedAd();
    return;
  }
  const ad = getOrCreateAd();
  if (!ad) return;

  await new Promise<void>((resolve) => {
    let done = false;
    const settle = (show: boolean) => {
      if (done) return;
      done = true;
      unsubLoaded();
      unsubError();
      clearTimeout(timer);
      if (show) void showLoadedAd().finally(resolve);
      else resolve();
    };
    const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => settle(true));
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => settle(false));
    const timer = setTimeout(() => settle(false), timeoutMs);
  });
}

/**
 * 백그라운드 → 포그라운드: 쿨다운·로드 상태 확인 후 1회 표시.
 */
export async function tryShowForegroundAppOpenAd(): Promise<void> {
  if (!isAppOpenAdFeatureOn() || !isAdsSupported()) return;
  const now = Date.now();
  if (now - lastForegroundShowAt < FOREGROUND_COOLDOWN_MS) return;
  if (!isLoaded || isShowing) {
    preloadAppOpenAd();
    return;
  }
  lastForegroundShowAt = now;
  await showLoadedAd();
}

export function subscribeAppOpenAdOnForeground(): () => void {
  if (!APP_OPEN_AD_ENABLED || !isAdsSupported()) return () => {};
  let prev: AppStateStatus = AppState.currentState;
  const sub = AppState.addEventListener('change', (next) => {
    if (prev.match(/inactive|background/) && next === 'active') {
      void tryShowForegroundAppOpenAd();
    }
    prev = next;
  });
  return () => sub.remove();
}
