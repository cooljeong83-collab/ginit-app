import Constants from 'expo-constants';
import { GoogleAuthProvider, signInWithCredential, signOut, type User } from 'firebase/auth';

import { publicEnv } from '@/src/config/public-env';

import type { RedirectConsumeMeta } from './google-sign-in-redirect-meta';
import { getFirebaseAuth } from './firebase';

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
let configured = false;

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

function ensureConfigured(gs: GoogleSigninApi) {
  if (configured) return;
  const webClientId = publicEnv.googleWebClientId?.trim();
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID(웹 OAuth 클라이언트 ID)가 비어 있습니다. env/.env에 넣고 Metro를 재시작하세요.',
    );
  }
  gs.configure({ webClientId });
  configured = true;
}

export async function signInWithGoogle(): Promise<User> {
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
  ensureConfigured(GoogleSignin);
  logCurrentAuth('signInWithGoogle:after configure');

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
  try {
    log('Auth Step 2 → signInWithCredential (Firebase)', { idTokenLength: idToken.length });
    const credential = GoogleAuthProvider.credential(idToken);
    const { user } = await signInWithCredential(getFirebaseAuth(), credential);
    log('Auth Step 2: Result Received (native credential success)', {
      uid: user.uid,
      email: user.email ?? null,
    });
    logCurrentAuth('signInWithGoogle:after credential success');
    return user;
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
    await GoogleSignin.signOut();
  } catch {
    // noop
  }
  try {
    await signOut(getFirebaseAuth());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`로그아웃 실패: ${msg}`);
  }
}
