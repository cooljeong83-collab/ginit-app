import type { User } from '@supabase/supabase-js';

/** People API 점진적 동의 — `google-people-demographics-consent`와 동일 */
export type GooglePeopleDemographicField = 'gender' | 'birth';

export type SignInWithGoogleOptions = {
  /** 가입 시 생일·성별 People API용 OAuth 범위 추가 */
  forRegistration?: boolean;
  /**
   * People API용 OAuth — 지정 시 해당 항목 스코프만 요청(점진적 동의).
   * `forRegistration`이 true이면 미지정 시 성별·생년월일 모두 포함.
   */
  peopleDemographicFields?: readonly GooglePeopleDemographicField[];
  /**
   * 웹 OAuth만: `false`이면 `select_account` 대신 `consent`로 추가 스코프 동의 위주.
   * 기본은 계정 선택 UI를 허용합니다.
   */
  promptSelectAccount?: boolean;
};

export type GoogleSignInResult = {
  user: User;
  /** People API 등 — 없을 수 있음 */
  googleAccessToken: string | null;
  /** PostgREST `rpc` 호출 시 기본 클라이언트의 `getSession()` 락을 피하기 위한 JWT */
  supabaseAccessToken: string;
  /** OAuth로 처음 생성된 Supabase 사용자인지(가능한 경우에만) */
  isNewUser?: boolean;
};
