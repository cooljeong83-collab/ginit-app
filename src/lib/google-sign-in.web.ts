import { signOutSupabase, supabase } from '@/src/lib/supabase';

import { googlePeopleScopesForFields } from '@/src/lib/google-people-oauth-scopes';

import type { RedirectConsumeMeta } from './google-sign-in-redirect-meta';
import type { GoogleSignInResult, SignInWithGoogleOptions } from './google-sign-in-result';

export const REDIRECT_STARTED = 'auth/redirect-started';

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

function googleScopes(options?: SignInWithGoogleOptions): string {
  const base = 'email profile';
  const fields = options?.peopleDemographicFields;
  if (options?.forRegistration) {
    return `${base} https://www.googleapis.com/auth/user.birthday.read https://www.googleapis.com/auth/user.gender.read`;
  }
  if (fields?.length) {
    return [base, ...googlePeopleScopesForFields(fields)].join(' ');
  }
  return base;
}

async function waitForSessionFromOAuthPopup(maxMs: number): Promise<import('@supabase/supabase-js').Session | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) return session;
    await new Promise((r) => setTimeout(r, 420));
  }
  return null;
}

/** OAuth 복귀 후(같은 출처·팝업 포함) 세션을 한 번 동기화합니다. */
export async function consumeGoogleRedirectResultWithMeta(): Promise<RedirectConsumeMeta> {
  log('consumeGoogleRedirectResultWithMeta → start');
  if (!isBrowser()) {
    log('consumeGoogleRedirectResultWithMeta → noop (not-browser)');
    return { status: 'noop', reason: 'not-browser' };
  }
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (error) {
      const { code, message } = pickErr(error);
      return { status: 'error', code, message, raw: error };
    }
    const user = session?.user;
    if (!user) {
      log('consumeGoogleRedirectResultWithMeta → empty');
      return { status: 'empty' };
    }
    const hasGoogle = user.identities?.some((i) => i.provider === 'google');
    if (!hasGoogle) {
      return { status: 'empty' };
    }
    log('consumeGoogleRedirectResultWithMeta → success', { id: user.id });
    return { status: 'success', user };
  } catch (e) {
    const { code, message } = pickErr(e);
    return { status: 'error', code, message, raw: e };
  }
}

export async function consumeGoogleRedirectResult(): Promise<import('@supabase/supabase-js').User | null> {
  const m = await consumeGoogleRedirectResultWithMeta();
  if (m.status === 'success') return m.user;
  return null;
}

export async function signInWithGoogle(options?: SignInWithGoogleOptions): Promise<GoogleSignInResult> {
  log('signInWithGoogle → start (web)', {
    isBrowser: isBrowser(),
    isMobileUserAgent: isMobileUserAgent(),
  });

  if (!isBrowser()) {
    const err = new Error('Google 로그인(웹)은 브라우저 환경에서만 사용할 수 있습니다.');
    log('signInWithGoogle → Error', { code: '(none)', message: err.message });
    throw err;
  }

  const redirectTo = `${window.location.origin}/login`;
  const scopes = googleScopes(options);
  const queryParams: Record<string, string> = {
    prompt: options?.promptSelectAccount === false ? 'consent' : 'select_account',
    access_type: 'offline',
  };

  const oauthBase = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes,
        queryParams,
        skipBrowserRedirect: true,
      },
    });
    if (error) throw attachCode(new Error(error.message), error.code);
    if (!data.url) throw new Error('OAuth URL을 받지 못했습니다.');
    return data.url;
  };

  if (isMobileUserAgent()) {
    log('Auth Step 1 → full redirect OAuth (mobile web)');
    const url = await oauthBase();
    window.location.assign(url);
    const err = new Error('리다이렉트 로그인을 시작했습니다. 잠시 후 이 페이지로 돌아오면 로그인이 완료됩니다.');
    (err as Error & { code?: string }).code = REDIRECT_STARTED;
    throw err;
  }

  log('Auth Step 1 → popup OAuth (desktop web)');
  const url = await oauthBase();
  const pop = window.open(url, 'ginit_google_oauth', 'width=520,height=700,scrollbars=yes');
  if (!pop) {
    throw new Error('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.');
  }
  const session = await waitForSessionFromOAuthPopup(180_000);
  try {
    pop.close();
  } catch {
    /* noop */
  }
  if (!session?.user) {
    throw new Error('Google 로그인 시간이 초과되었거나 취소되었습니다.');
  }
  const googleAccessToken = session.provider_token ?? null;
  const supabaseAccessToken = session.access_token?.trim() ?? '';
  if (!supabaseAccessToken) {
    throw new Error('Supabase access_token을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  log('Auth Step 2: Result Received (popup)', { uid: session.user.id });
  return { user: session.user, googleAccessToken, supabaseAccessToken };
}

/** Supabase 세션의 Google provider access token (없으면 null). */
export async function getGoogleAccessTokenIfAvailable(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.provider_token?.trim() ?? null;
}

/** 웹: 추가 스코프는 `signInWithGoogle({ peopleDemographicFields })`로 처리. 세션 토큰만 반환. */
export async function addGooglePeopleScopesAndGetAccessToken(): Promise<string | null> {
  return getGoogleAccessTokenIfAvailable();
}

export async function signOutGoogle(): Promise<void> {
  log('signOutGoogle → start');
  await signOutSupabase();
  log('signOutGoogle → success');
}
