import { Platform } from 'react-native';
import mobileAds from 'react-native-google-mobile-ads';

let initPromise: Promise<void> | null = null;

/** `AdMobBootstrap`·네이티브 광고 카드가 공유 — SDK 초기화 완료 후 `createForAdRequest` */
export function ensureMobileAdsInitialized(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!initPromise) {
    initPromise = mobileAds()
      .initialize()
      .then(() => undefined)
      .catch((e: unknown) => {
        initPromise = null;
        throw e;
      });
  }
  return initPromise;
}
