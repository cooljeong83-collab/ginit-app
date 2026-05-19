import { InteractionManager } from 'react-native';

import { presentGamificationPenaltyResult } from '@/src/lib/gamification-stat-change-present';

/** `PushNotificationBootstrap` 탭 시 프로필 탭으로 이동 */
export const TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION = 'trust_penalty_profile';

export type TrustPenaltyNotifyParams = {
  trustPoints: number;
  xpPoints: number;
};

/**
 * 확정 모임 나가기 등으로 신뢰 패널티가 반영된 뒤 결과 모달 표시.
 */
export function notifyTrustPenaltyAppliedFireAndForget(params: TrustPenaltyNotifyParams): void {
  InteractionManager.runAfterInteractions(() => {
    presentGamificationPenaltyResult({
      trustDrop: params.trustPoints,
      xpDrop: params.xpPoints,
      onGoProfile: () => {
        void import('expo-router')
          .then(({ router }) => {
            router.push('/(tabs)/profile');
          })
          .catch(() => {});
      },
    });
  });
}
