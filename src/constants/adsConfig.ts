import { TestIds } from 'react-native-google-mobile-ads';

/**
 * 앱 오프닝 광고(콜드 스타트·백그라운드 복귀).
 * 나중에 켤 때는 `true`로만 바꾸면 됩니다(프리로드·표시 경로는 서비스에서 이 값을 봅니다).
 */
export const APP_OPEN_AD_ENABLED = false;

const PROD = {
  appOpen: 'ca-app-pub-9261880911862776/6053888594',
  interstitial: 'ca-app-pub-9261880911862776/7705504312',
  nativeFeed: 'ca-app-pub-9261880911862776/3984917006',
  nativeMeetingDetail: 'ca-app-pub-9261880911862776/3490927130',
} as const;

export const AD_UNIT_IDS = __DEV__
  ? {
      appOpen: TestIds.APP_OPEN,
      interstitial: TestIds.INTERSTITIAL,
      nativeFeed: TestIds.NATIVE,
      nativeMeetingDetail: TestIds.NATIVE,
    }
  : PROD;

/**
 * 탐색 피드: 목록에서 5·10·15…번째 칸이 광고(모임 카드 4개 뒤마다 1칸).
 * 랜덤 없음 — `injectFeedNativeAdRows`가 고정 주기로 삽입합니다.
 */
export const FEED_NATIVE_AD_INTERVAL = 5;

/** FlashList `overrideItemLayout` — `HomeMeetingListItem` 추정 높이와 동일 */
export { HOME_MEETING_ROW_ESTIMATED_HEIGHT as FEED_NATIVE_AD_ROW_HEIGHT } from '@/src/lib/feed-meeting-review-carousel-layout';
