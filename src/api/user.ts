import { getUserProfile, recordTermsAgreement, withdrawAnonymizeUserProfile } from '@/src/lib/user-profile';

/**
 * 얇은 API 레이어(현재는 Firestore 직접 호출).
 * 추후 서버 API로 이관 시 이 파일만 교체하도록 분리합니다.
 */
export const userApi = {
  getUserProfile,
  recordTermsAgreement,
  withdrawAnonymizeUserProfile,
};

