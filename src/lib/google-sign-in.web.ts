import {
  GoogleAuthProvider,
  getRedirectResult,
  OAuthCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
  type UserCredential,
} from 'firebase/auth';

import type { RedirectConsumeMeta } from './google-sign-in-redirect-meta';
import type { GoogleSignInResult, SignInWithGoogleOptions } from './google-sign-in-result';
import { getFirebaseAuth } from './firebase';

const REDIRECT_STARTED = 'auth/redirect-started';
const LOG = '[GinitAuth:Web]';

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

function attachCode(err: Error, code?: string) {
  if (code) (err as Error & { code?: string }).code = code;
  return err;
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

function isBrowser(): boolean {
  try {
    return typeof globalThis !== 'undefined' && 'window' in globalThis && typeof (globalThis as { window?: unknown }).window !== 'undefined';
  } catch {
    return false;
  }
}

function isMobileUserAgent(): boolean {
  try {
    if (!isBrowser()) return false;
    const w = globalThis as { navigator?: { userAgent?: string } };
    const ua = w.navigator?.userAgent ?? '';
    return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  } catch {
    return false;
  }
}

/** 리다이렉트 로그인으로 돌아온 뒤(같은 탭) 한 번 호출해 세션을 복구합니다. */
export async function consumeGoogleRedirectResultWithMeta(): Promise<RedirectConsumeMeta> {
  log('consumeGoogleRedirectResultWithMeta → start');
  if (!isBrowser()) {
    log('consumeGoogleRedirectResultWithMeta → noop (not-browser)');
    return { status: 'noop', reason: 'not-browser' };
  }
  logCurrentAuth('consumeGoogleRedirectResultWithMeta:before getRedirectResult');
  const auth = getFirebaseAuth();
  try {
    log('consumeGoogleRedirectResultWithMeta → calling getRedirectResult (Auth Step 2: redirect result)');
    const result = await getRedirectResult(auth);
    if (result?.user) {
      log('consumeGoogleRedirectResultWithMeta → Auth Step 2: Result Received (success)', {
        uid: result.user.uid,
        email: result.user.email ?? null,
      });
      logCurrentAuth('consumeGoogleRedirectResultWithMeta:after success');
      return { status: 'success', user: result.user };
    }
    log('consumeGoogleRedirectResultWithMeta → empty (no pending redirect credential)', {
      hasCredential: !!result,
    });
    return { status: 'empty' };
  } catch (e) {
    const { code, message } = pickErr(e);
    log('consumeGoogleRedirectResultWithMeta → Error', { code: code ?? '(no code)', message, raw: String(e) });
    logCurrentAuth('consumeGoogleRedirectResultWithMeta:after error');
    return { status: 'error', code, message, raw: e };
  }
}

export async function consumeGoogleRedirectResult(): Promise<User | null> {
  const m = await consumeGoogleRedirectResultWithMeta();
  if (m.status === 'success') return m.user;
  return null;
}

export async function signInWithGoogle(options?: SignInWithGoogleOptions): Promise<GoogleSignInResult> {
  log('signInWithGoogle → start (handleLogin equivalent on web)', {
    isBrowser: isBrowser(),
    isMobileUserAgent: isMobileUserAgent(),
  });
  logCurrentAuth('signInWithGoogle:start');

  if (!isBrowser()) {
    const err = new Error('Google 로그인(웹)은 브라우저 환경에서만 사용할 수 있습니다.');
    log('signInWithGoogle → Error', { code: '(none)', message: err.message });
    throw err;
  }

  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (options?.forRegistration) {
    provider.addScope('https://www.googleapis.com/auth/user.birthday.read');
    provider.addScope('https://www.googleapis.com/auth/user.gender.read');
  }

  if (isMobileUserAgent()) {
    log('Auth Step 1 → about to open redirect flow (signInWithRedirect)', {
      providerId: provider.providerId,
    });
    logCurrentAuth('signInWithGoogle:before signInWithRedirect');
    try {
      await signInWithRedirect(auth, provider);
      log('signInWithGoogle → signInWithRedirect returned (unexpected if redirect leaves page)');
    } catch (e) {
      const { code, message } = pickErr(e);
      log('Error:signInWithRedirect', { code: code ?? '(no code)', message });
      logCurrentAuth('signInWithGoogle:after signInWithRedirect error');
      throw attachCode(new Error(`Google 리다이렉트 로그인을 시작할 수 없습니다: ${message}`), code);
    }
    const err = new Error('리다이렉트 로그인을 시작했습니다. 잠시 후 이 페이지로 돌아오면 로그인이 완료됩니다.');
    (err as Error & { code?: string }).code = REDIRECT_STARTED;
    log('signInWithGoogle → Auth Step 1 done; throwing REDIRECT_STARTED (page should navigate away)', {
      code: REDIRECT_STARTED,
    });
    throw err;
  }

  log('Auth Step 1 → about to open popup (signInWithPopup)');
  logCurrentAuth('signInWithGoogle:before signInWithPopup');
  try {
    const result = (await signInWithPopup(auth, provider)) as UserCredential;
    const { user } = result;
    const oauth = GoogleAuthProvider.credentialFromResult(result) as OAuthCredential | null;
    const googleAccessToken = oauth?.accessToken ?? null;
    log('Auth Step 2: Result Received (popup success)', {
      uid: user.uid,
      email: user.email ?? null,
    });
    logCurrentAuth('signInWithGoogle:after popup success');
    return { user, googleAccessToken };
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:signInWithPopup', { code: code ?? '(no code)', message });
    logCurrentAuth('signInWithGoogle:after popup error');
    throw attachCode(new Error(`Google 팝업 로그인 실패: ${message}`), code);
  }
}

export async function signOutGoogle(): Promise<void> {
  const auth = getFirebaseAuth();
  log('signOutGoogle → start');
  logCurrentAuth('signOutGoogle:before');
  try {
    await signOut(auth);
    log('signOutGoogle → success');
    logCurrentAuth('signOutGoogle:after');
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:signOutGoogle', { code: code ?? '(no code)', message });
    throw attachCode(new Error(`로그아웃 실패: ${message}`), code);
  }
}

export { REDIRECT_STARTED };
