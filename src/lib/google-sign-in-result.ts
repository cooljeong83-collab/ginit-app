import type { User } from 'firebase/auth';

export type SignInWithGoogleOptions = {
  /** 가입 시 생일·성별 People API용 OAuth 범위 추가 */
  forRegistration?: boolean;
  /**
   * 웹 `signInWithPopup`만: `false`이면 `select_account` 대신 `consent`로 추가 스코프 동의 위주(이미 로그인된 계정 재선택 완화).
   * 기본은 계정 선택 UI를 허용합니다.
   */
  promptSelectAccount?: boolean;
};

export type GoogleSignInResult = {
  user: User;
  /** People API 등 — 없을 수 있음 */
  googleAccessToken: string | null;
  /** Firebase에 이 자격 증명으로 처음 연결된 경우(팝업·네이티브 credential 경로) */
  isNewUser?: boolean;
};
