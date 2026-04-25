import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensureGinitInAppAndroidChannel, GINIT_IN_APP_ANDROID_CHANNEL } from '@/src/lib/in-app-alarm-push';

/** `PushNotificationBootstrap` 탭 시 프로필 탭으로 이동 */
export const TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION = 'trust_penalty_profile';

export type TrustPenaltyNotifyParams = {
  trustPoints: number;
  xpPoints: number;
};

/**
 * 확정 모임 나가기 등으로 신뢰 패널티가 반영된 뒤 로컬 푸시(탭 → 프로필).
 * 웹은 호출부에서 `Alert` 등으로 처리합니다.
 */
export function notifyTrustPenaltyAppliedFireAndForget(params: TrustPenaltyNotifyParams): void {
  void (async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureGinitInAppAndroidChannel();
      const trigger =
        Platform.OS === 'android' ? { channelId: GINIT_IN_APP_ANDROID_CHANNEL } : null;
      const title = '신뢰 패널티가 반영됐어요';
      const body = `gTrust ${params.trustPoints}점·XP ${params.xpPoints}가 차감됐고, 누적 패널티가 1회 늘었어요. 탭하면 프로필에서 확인할 수 있어요.`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          data: { action: TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION },
          interruptionLevel: 'active',
          priority: 'high',
        },
        trigger,
      });
    } catch (e) {
      if (__DEV__) {
        console.warn('[trust-penalty-notify]', e);
      }
    }
  })();
}
