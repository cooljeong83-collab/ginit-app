import { InteractionManager } from 'react-native';

import { presentGamificationPenaltyResult } from '@/src/lib/gamification-stat-change-present';

export const TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION = 'trust_penalty_profile';

export type TrustPenaltyNotifyParams = {
  trustPoints: number;
  xpPoints: number;
};

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
