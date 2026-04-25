/** 웹: 로컬 푸시 미사용 — `expo-notifications`를 로드하지 않습니다. */

export const TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION = 'trust_penalty_profile';

export type TrustPenaltyNotifyParams = {
  trustPoints: number;
  xpPoints: number;
};

export function notifyTrustPenaltyAppliedFireAndForget(_params: TrustPenaltyNotifyParams): void {}
