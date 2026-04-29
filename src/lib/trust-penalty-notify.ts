import { Platform } from 'react-native';

/** `PushNotificationBootstrap` 탭 시 프로필 탭으로 이동 */
export const TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION = 'trust_penalty_profile';

export type TrustPenaltyNotifyParams = {
  trustPoints: number;
  xpPoints: number;
};

/**
 * 확정 모임 나가기 등으로 신뢰 패널티가 반영된 뒤 알림.
 * 로컬 알림은 제거되어 현재는 no-op입니다.
 * 웹은 호출부에서 `Alert` 등으로 처리합니다.
 */
export function notifyTrustPenaltyAppliedFireAndForget(_params: TrustPenaltyNotifyParams): void {
  void (async () => {
    try {
      if (Platform.OS === 'web') return;
      return;
    } catch (e) {
      if (__DEV__) {
        console.warn('[trust-penalty-notify]', e);
      }
    }
  })();
}
