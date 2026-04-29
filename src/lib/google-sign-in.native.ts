import Constants from 'expo-constants';
import { GoogleAuthProvider, signInWithCredential, signOut, type User } from 'firebase/auth';

import { publicEnv } from '@/src/config/public-env';

import { getFirebaseAuth } from './firebase';
import type { RedirectConsumeMeta } from './google-sign-in-redirect-meta';
import type { GoogleSignInResult, SignInWithGoogleOptions } from './google-sign-in-result';

export const REDIRECT_STARTED = 'auth/redirect-started';

const LOG = '[GinitAuth:Native]';

function ts() {
  return new Date().toISOString();
}

function log(step: string, extra?: Record<string, unknown>) {
  if (extra && Object.keys(extra).length > 0) {
    console.log(LOG, ts(), step, extra);
  } else {
    console.log(LOG, ts(), step);
  }
}

function pickErr(e: unknown): { code?: string; message: string } {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; message?: unknown };
    const code = typeof o.code === 'string' ? o.code : undefined;
    const message =
      typeof o.message === 'string'
        ? o.message
        : e instanceof Error
          ? e.message
          : JSON.stringify(e);
    return { code, message };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}

function logCurrentAuth(prefix: string) {
  try {
    const a = getFirebaseAuth();
    const u = a.currentUser;
    log(`${prefix} auth.currentUser`, {
      hasCurrentUser: !!u,
      uid: u?.uid ?? null,
      email: u?.email ?? null,
      isAnonymous: u?.isAnonymous ?? null,
    });
  } catch (e) {
    log(`${prefix} auth.currentUser (read failed)`, { ...pickErr(e) });
  }
}

/** 상단에서 `import` 하면 Expo Go에서 모듈 로드 시점에 RNGoogleSignin을 찾다가 크래시합니다. */
type GoogleSigninApi = typeof import('@react-native-google-signin/google-signin').GoogleSignin;

let googleSignin: GoogleSigninApi | null = null;
let configureSignature = '';


function requireGoogleSignin(): GoogleSigninApi {
  if (googleSignin) return googleSignin;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  googleSignin = mod.GoogleSignin;
  return googleSignin;
}

/** 네이티브 앱에서는 리다이렉트 플로우를 사용하지 않습니다. */
export async function consumeGoogleRedirectResultWithMeta(): Promise<RedirectConsumeMeta> {
  log('consumeGoogleRedirectResultWithMeta → noop (native)');
  return { status: 'noop', reason: 'native' };
}

export async function consumeGoogleRedirectResult(): Promise<User | null> {
  return null;
}

function isExpoGo(): boolean {
  try {
    return Constants.appOwnership === 'expo';
  } catch {
    return false;
  }
}

function ensureConfigured(gs: GoogleSigninApi, options?: SignInWithGoogleOptions) {
  const webClientId = publicEnv.googleWebClientId?.trim();
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID(웹 OAuth 클라이언트 ID)가 비어 있습니다. env/.env에 넣고 Metro를 재시작하세요.',
    );
  }
  const scopes: string[] = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];
  if (options?.forRegistration) {
    scopes.push(
      'https://www.googleapis.com/auth/user.birthday.read',
      'https://www.googleapis.com/auth/user.gender.read',
    );
  }
  const sig = `${webClientId}|${scopes.join(',')}`;
  if (configureSignature === sig) return;
  gs.configure({ webClientId, scopes });
  configureSignature = sig;
}

export async function signInWithGoogle(options?: SignInWithGoogleOptions): Promise<GoogleSignInResult> {
  log('signInWithGoogle → start (handleLogin equivalent on native)', { expoGo: isExpoGo() });
  logCurrentAuth('signInWithGoogle:start');

  if (isExpoGo()) {
    const err = new Error(
      'Expo Go에는 Google 네이티브 로그인 모듈이 포함되어 있지 않습니다. 같은 기기의 브라우저로 웹(Metro 웹)에 접속하거나, `npx expo run:android` / `run:ios`로 개발 빌드를 만든 뒤 테스트하세요.',
    );
    log('Error:expo-go', { code: '(none)', message: err.message });
    throw err;
  }

  log('Auth Step 1 → require GoogleSignin module & configure');
  const GoogleSignin = requireGoogleSignin();
  ensureConfigured(GoogleSignin, options);
  logCurrentAuth('signInWithGoogle:after configure');

  // 로그아웃 직후에도 Android는 `getLastSignedInAccount`가 남는 경우가 있어, 계정 선택 UI를 위해 잔여 세션을 끊습니다.
  try {
    const hasPrev = GoogleSignin.hasPreviousSignIn?.() === true;
    const cur = GoogleSignin.getCurrentUser?.();
    if (hasPrev || cur) {
      try {
        await GoogleSignin.revokeAccess();
      } catch {
        /* 세션 없음 등 */
      }
      try {
        await GoogleSignin.signOut();
      } catch {
        /* noop */
      }
    }
  } catch {
    /* hasPreviousSignIn 미지원 등 */
  }

  try {
    log('Auth Step 1 → hasPlayServices');
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:hasPlayServices', { code: code ?? '(no code)', message });
    logCurrentAuth('signInWithGoogle:after hasPlayServices error');
    throw new Error(`Google Play 서비스 확인 실패: ${message}`);
  }

  let res: Awaited<ReturnType<GoogleSigninApi['signIn']>>;
  try {
    log('Auth Step 1 → opening Google sign-in UI (signIn)', {
      hadUser: !!getFirebaseAuth().currentUser,
    });
    res = await GoogleSignin.signIn();
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:GoogleSignin.signIn', { code: code ?? '(no code)', message });
    logCurrentAuth('signInWithGoogle:after signIn error');
    const isDeveloperError =
      message.includes('DEVELOPER_ERROR') || code === '10' || code === 'DEVELOPER_ERROR';
    if (isDeveloperError) {
      throw new Error(
        'Google Android 로그인 설정 오류(DEVELOPER_ERROR). 다음을 확인하세요: (1) Firebase 콘솔 → 프로젝트 설정 → 내 Android 앱에 디버그·릴리스 SHA-1 등록 (2) 등록 후 `google-services.json`을 다시 내려받아 `env/google-services.json`과 `android/app/google-services.json`에 반영 — `oauth_client` 배열이 비어 있으면 아직 SHA가 반영되지 않은 것입니다 (3) `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`는 이 Firebase 프로젝트와 연결된 Google Cloud의 「OAuth 2.0 웹 클라이언트」ID여야 합니다(다른 GCP 프로젝트의 클라이언트 ID면 실패합니다). SHA 확인: `cd android && ./gradlew signingReport`',
      );
    }
    throw new Error(`Google 로그인 UI 실패: ${message}`);
  }

  if (res.type !== 'success') {
    log('Error:signIn cancelled or non-success', { type: res.type });
    throw new Error('로그인이 취소되었습니다.');
  }
  const idToken = res.data.idToken;
  if (!idToken) {
    const err = new Error(
      'Google idToken이 없습니다. Firebase·Google Cloud에서 Android SHA-1과 EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID를 확인하세요.',
    );
    log('Error:no-idToken', { message: err.message });
    throw err;
  }
  /** People API용 OAuth 액세스 토큰은 Firebase 연동 전에 받는 편이 안정적입니다(연동 후 getTokens가 빈 값이 되는 기기 대응). */
  let googleAccessToken: string | null = null;
  try {
    const tPre = await GoogleSignin.getTokens();
    googleAccessToken = (tPre.accessToken ?? '').trim() || null;
  } catch (e) {
    const { message } = pickErr(e);
    log('Warn:getTokens before Firebase credential', { message });
  }
  try {
    log('Auth Step 2 → signInWithCredential (Firebase)', { idTokenLength: idToken.length });
    const credential = GoogleAuthProvider.credential(idToken);
    const { user } = await signInWithCredential(getFirebaseAuth(), credential);
    log('Auth Step 2: Result Received (native credential success)', {
      uid: user.uid,
      email: user.email ?? null,
    });
    logCurrentAuth('signInWithGoogle:after credential success');
    if (!googleAccessToken) {
      try {
        const tPost = await GoogleSignin.getTokens();
        googleAccessToken = (tPost.accessToken ?? '').trim() || null;
      } catch (e) {
        const { message } = pickErr(e);
        log('Warn:getTokens after Firebase credential', { message });
      }
    }
    return { user, googleAccessToken };
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:signInWithCredential', { code: code ?? '(no code)', message });
    logCurrentAuth('signInWithGoogle:after credential error');
    throw new Error(`Firebase 로그인 연동 실패: ${message}`);
  }
}

export async function signOutGoogle(): Promise<void> {
  log('signOutGoogle → start', { expoGo: isExpoGo() });
  logCurrentAuth('signOutGoogle:before');
  if (isExpoGo()) {
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // noop
    }
    log('signOutGoogle → expo-go path done (Firebase only)');
    logCurrentAuth('signOutGoogle:after expo-go');
    return;
  }
  try {
    const GoogleSignin = requireGoogleSignin();
    // configure 없이 signOut만 호출되면 Android RNGoogleSigninModule의 _apiClient가 null이라
    // 네이티브 Google 세션이 안 지워지고 다음 로그인에서 마지막 계정으로 바로 이어질 수 있습니다.
    ensureConfigured(GoogleSignin, { forRegistration: false });
    try {
      await GoogleSignin.revokeAccess();
    } catch {
      /* 이미 끊김 등 */
    }
    try {
      await GoogleSignin.signOut();
    } catch {
      /* noop */
    }
  } catch {
    // noop (Expo Go 외에도 모듈/설정 오류 시 Firebase만이라도 아래에서 정리)
  }
  try {
    await signOut(getFirebaseAuth());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`로그아웃 실패: ${msg}`);
  }
}
