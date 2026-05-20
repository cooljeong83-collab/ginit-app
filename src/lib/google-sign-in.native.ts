import Constants from 'expo-constants';
import type { User } from '@supabase/supabase-js';

import { publicEnv } from '@/src/config/public-env';
import { signOutSupabase, supabase } from '@/src/lib/supabase';

import {
  googlePeopleScopesForFields,
  GOOGLE_OAUTH_SCOPE_BIRTHDAY,
  GOOGLE_OAUTH_SCOPE_GENDER,
} from '@/src/lib/google-people-oauth-scopes';
import type { GooglePeopleDemographicField } from '@/src/lib/google-sign-in-result';

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
    scopes.push(GOOGLE_OAUTH_SCOPE_BIRTHDAY, GOOGLE_OAUTH_SCOPE_GENDER);
  } else if (options?.peopleDemographicFields?.length) {
    for (const s of googlePeopleScopesForFields(options.peopleDemographicFields)) {
      if (!scopes.includes(s)) scopes.push(s);
    }
  }
  const sig = `${webClientId}|${scopes.join(',')}`;
  if (configureSignature === sig) return;
  gs.configure({ webClientId, scopes });
  configureSignature = sig;
}

/**
 * 네이티브 Google Sign-In access token (추가 동의 없이). 세션 없으면 null.
 */
export async function getGoogleAccessTokenIfAvailable(): Promise<string | null> {
  if (isExpoGo()) return null;
  const GoogleSignin = requireGoogleSignin();
  ensureConfigured(GoogleSignin, { forRegistration: false });
  if (!GoogleSignin.getCurrentUser?.()) return null;
  try {
    const t = await GoogleSignin.getTokens();
    return (t.accessToken ?? '').trim() || null;
  } catch (e) {
    const { message } = pickErr(e);
    log('Warn:getGoogleAccessTokenIfAvailable', { message });
    return null;
  }
}

/**
 * 이미 Google+Supabase 로그인된 상태에서 People API용 스코프만 추가 동의.
 * @param fields 생략 시 성별·생년월일 모두 요청. 지정 시 해당 스코프만 재요청.
 */
export async function addGooglePeopleScopesAndGetAccessToken(
  fields?: readonly GooglePeopleDemographicField[],
): Promise<string | null> {
  const scopes =
    fields && fields.length > 0
      ? googlePeopleScopesForFields(fields)
      : [GOOGLE_OAUTH_SCOPE_BIRTHDAY, GOOGLE_OAUTH_SCOPE_GENDER];
  log('addGooglePeopleScopesAndGetAccessToken → start', { expoGo: isExpoGo(), scopes });
  if (isExpoGo()) {
    throw new Error(
      'Expo Go에는 Google 네이티브 로그인 모듈이 포함되어 있지 않습니다. `npx expo run:android` / `run:ios`로 개발 빌드를 만든 뒤 테스트하세요.',
    );
  }
  const GoogleSignin = requireGoogleSignin();
  ensureConfigured(GoogleSignin, { forRegistration: false });
  if (!GoogleSignin.getCurrentUser?.()) {
    throw new Error('Google 로그인 세션이 없습니다. 먼저 Google로 로그인해 주세요.');
  }
  try {
    const res = await GoogleSignin.addScopes({ scopes });
    if (res == null) {
      throw new Error('Google 추가 동의를 진행할 수 없습니다. 다시 로그인해 주세요.');
    }
    if (res.type !== 'success') {
      log('addGooglePeopleScopesAndGetAccessToken → non-success', { type: res.type });
      throw new Error('로그인이 취소되었습니다.');
    }
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:addScopes', { code: code ?? '(no code)', message });
    throw new Error(message || 'Google 추가 동의에 실패했습니다.');
  }
  try {
    const t = await GoogleSignin.getTokens();
    const at = (t.accessToken ?? '').trim() || null;
    log('addGooglePeopleScopesAndGetAccessToken → success', { hasToken: !!at });
    return at;
  } catch (e) {
    const { message } = pickErr(e);
    log('Warn:addScopes getTokens', { message });
    return null;
  }
}

export async function signInWithGoogle(options?: SignInWithGoogleOptions): Promise<GoogleSignInResult> {
  log('signInWithGoogle → start (native)', { expoGo: isExpoGo() });

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

  try {
    const hasPrev = GoogleSignin.hasPreviousSignIn?.() === true;
    const cur = GoogleSignin.getCurrentUser?.();
    if (hasPrev || cur) {
      /**
       * `revokeAccess()`는 Play 서비스·네트워크에서 수 분까지 걸리는 사례가 있어(재로그인 시 인증 화면이 멈춘 것처럼 보임) 쓰지 않습니다.
       * 계정 선택은 `signIn()` UI로 충분한 경우가 많고, 필요하면 사용자가 OS 설정에서 연결을 끊을 수 있습니다.
       */
      const SIGN_OUT_MS = 5000;
      let tid: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        tid = setTimeout(() => reject(new Error('GoogleSignin.signOut timeout (pre-signIn)')), SIGN_OUT_MS);
      });
      try {
        await Promise.race([GoogleSignin.signOut(), deadline]);
      } catch (e) {
        log('Warn:preSignIn signOut', pickErr(e));
      } finally {
        if (tid) clearTimeout(tid);
      }
    }
  } catch {
    /* noop */
  }

  try {
    log('Auth Step 1 → hasPlayServices');
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:hasPlayServices', { code: code ?? '(no code)', message });
    throw new Error(`Google Play 서비스 확인 실패: ${message}`);
  }

  let res: Awaited<ReturnType<GoogleSigninApi['signIn']>>;
  try {
    log('Auth Step 1 → opening Google sign-in UI (signIn)', {});
    res = await GoogleSignin.signIn();
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:GoogleSignin.signIn', { code: code ?? '(no code)', message });
    const isDeveloperError =
      message.includes('DEVELOPER_ERROR') || code === '10' || code === 'DEVELOPER_ERROR';
    if (isDeveloperError) {
      throw new Error(
        'Google Android 로그인 설정 오류(DEVELOPER_ERROR). SHA-1 등록·google-services.json·`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`(웹 클라이언트)를 확인하세요.',
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
      'Google idToken이 없습니다. Google Cloud OAuth 클라이언트·Android 설정을 확인하세요.',
    );
    log('Error:no-idToken', { message: err.message });
    throw err;
  }

  let googleAccessToken: string | null = null;
  try {
    const tPre = await GoogleSignin.getTokens();
    googleAccessToken = (tPre.accessToken ?? '').trim() || null;
  } catch (e) {
    const { message } = pickErr(e);
    log('Warn:getTokens before Supabase', { message });
  }

  try {
    log('Auth Step 2 → supabase.auth.signInWithIdToken', { idTokenLength: idToken.length });
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) throw error;
    const user = data.user;
    if (!user) throw new Error('Supabase 세션 사용자를 확인할 수 없습니다.');
    const supabaseAccessToken = data.session?.access_token?.trim() ?? '';
    if (!supabaseAccessToken) {
      throw new Error('Supabase access_token을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    log('Auth Step 2: Result Received', { uid: user.id, email: user.email ?? null });
    if (!googleAccessToken) {
      try {
        const tPost = await GoogleSignin.getTokens();
        googleAccessToken = (tPost.accessToken ?? '').trim() || null;
      } catch (e) {
        const { message } = pickErr(e);
        log('Warn:getTokens after Supabase', { message });
      }
    }
    return { user, googleAccessToken, supabaseAccessToken };
  } catch (e) {
    const { code, message } = pickErr(e);
    log('Error:signInWithIdToken', { code: code ?? '(no code)', message });
    let detail = message;
    if (code === 'provider_disabled' || /provider.*not enabled|not enabled/i.test(message)) {
      detail =
        'Supabase 대시보드(Authentication → Providers)에서 Google 제공자를 켜고, Web Client ID·시크릿을 저장한 뒤 다시 시도해 주세요.';
    }
    const err = new Error(`Supabase 로그인 연동 실패: ${detail}`) as Error & { code?: string };
    if (code) err.code = code;
    throw err;
  }
}

const GOOGLE_NATIVE_SIGN_OUT_MS = 5000;

export async function signOutGoogle(): Promise<void> {
  log('signOutGoogle → start', { expoGo: isExpoGo() });
  if (isExpoGo()) {
    await signOutSupabase();
    log('signOutGoogle → expo-go path done (Supabase)');
    return;
  }
  /**
   * 로그아웃은 빠르게 끝나야 합니다.
   * - `configure()`는 일부 기기에서 Play 서비스와 맞물려 오래 걸리거나 멈출 수 있어 호출하지 않습니다.
   *   (이미 로그인 시 configure가 호출된 상태라면 `signOut()`만으로 충분합니다.)
   * - 현재 Google 계정이 없으면 RNGS를 건드리지 않습니다.
   */
  try {
    log('signOutGoogle → require module');
    const GoogleSignin = requireGoogleSignin();
    const cur = GoogleSignin.getCurrentUser?.();
    if (!cur) {
      log('signOutGoogle → skip (no GoogleSignin current user)');
      return;
    }
    log('signOutGoogle → GoogleSignin.signOut (with timeout)', { ms: GOOGLE_NATIVE_SIGN_OUT_MS });
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`GoogleSignin.signOut timeout (${GOOGLE_NATIVE_SIGN_OUT_MS}ms)`)),
        GOOGLE_NATIVE_SIGN_OUT_MS,
      );
    });
    try {
      await Promise.race([GoogleSignin.signOut(), timeoutPromise]);
      log('signOutGoogle → GoogleSignin.signOut done');
    } catch (e) {
      log('signOutGoogle → GoogleSignin.signOut failed or timeout', pickErr(e));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch (e) {
    log('signOutGoogle → outer catch', pickErr(e));
  }
  /** Supabase 세션은 `UserSessionContext` → `AuthService.signOut`에서 끊습니다(중복·예외 방지). */
}
