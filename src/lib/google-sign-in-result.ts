import type { User } from 'firebase/auth';

export type SignInWithGoogleOptions = {
  /** 가입 시 생일·성별 People API용 OAuth 범위 추가 */
  forRegistration?: boolean;
};

export type GoogleSignInResult = {
  user: User;
  /** People API 등 — 없을 수 있음 */
  googleAccessToken: string | null;
};
