/**
 * Metro가 플랫폼별로 `google-sign-in.native.ts` / `google-sign-in.web.ts`를 선택합니다.
 * TypeScript는 이 파일을 통해 동일 시그니처를 인식합니다.
 */
export type { RedirectConsumeMeta } from './google-sign-in-redirect-meta';
export type { GoogleSignInResult, SignInWithGoogleOptions } from './google-sign-in-result';
export {
  consumeGoogleRedirectResult,
  consumeGoogleRedirectResultWithMeta,
  REDIRECT_STARTED,
  signInWithGoogle,
  signOutGoogle,
} from './google-sign-in.web';
