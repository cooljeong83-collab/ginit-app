import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';

const supabaseUrl = publicEnv.supabaseUrl;
const supabaseAnonKey = publicEnv.supabaseAnonKey;

if (__DEV__ && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    '[supabase] env/.env의 SUPABASE_URL·SUPABASE_ANON_KEY(또는 expo.extra)가 비어 있습니다.',
  );
}

function supabaseRealtimeReconnectAfterMs(tries: number): number {
  return Math.min(60_000, 800 * 2 ** Math.min(tries, 10));
}

/**
 * PostgREST/Auth REST가 네트워크·풀러에서 소켓에 걸리면 `rpc()`가 끝나지 않을 수 있습니다.
 * (로그: `googlePostSignIn ensureUserProfile_1` 직후 ~55초 뒤 `signOutSession` = 상위 타임아웃)
 * `AbortController`로 한 요청당 상한을 두어 재시도·에러 처리로 넘어가게 합니다.
 */
const SUPABASE_HTTP_FETCH_TIMEOUT_MS = 40_000;

/**
 * 기본 GoTrue AsyncStorage 키 — `sb-{project-ref}-auth-token` (`*.supabase.co` 호스트 첫 레이블).
 * `supabase.auth.storageKey`는 내부 세션 락과 맞물리면 **접근만으로도 오래/무한 대기**할 수 있어
 * 로그아웃·탈퇴 경로에서는 URL로만 계산합니다.
 */
function supabaseAuthStorageKeyFromUrl(url: string): string | null {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return null;
  try {
    const host = new URL(u).hostname;
    const ref = host.split('.')[0];
    if (!ref) return null;
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

async function supabaseFetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const outer = init?.signal;
  if (outer?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), SUPABASE_HTTP_FETCH_TIMEOUT_MS);
  const onOuterAbort = () => {
    clearTimeout(tid);
    controller.abort();
  };
  if (outer) {
    outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tid);
    if (outer) {
      outer.removeEventListener('abort', onOuterAbort);
    }
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  realtime: {
    reconnectAfterMs: supabaseRealtimeReconnectAfterMs,
  },
  global: {
    fetch: supabaseFetchWithTimeout,
  },
});

/**
 * `signInWithIdToken` 직후 등: 기본 클라이언트는 REST마다 `auth.getSession()` 락을 밟을 수 있어
 * (로그인 직후 RPC가 수십 초 멈춤 → UI 타임아웃) 같은 구간에만 사용합니다.
 */
export function createSupabaseClientWithAccessToken(accessToken: string): SupabaseClient {
  const token = accessToken.trim();
  if (!token) {
    throw new Error('[supabase] accessToken is empty');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      reconnectAfterMs: supabaseRealtimeReconnectAfterMs,
    },
    global: {
      fetch: supabaseFetchWithTimeout,
    },
    accessToken: async () => token,
  });
}

/**
 * 로그아웃·탈퇴 시 Supabase 세션을 확실히 끊습니다.
 * - **먼저** AsyncStorage의 세션 키를 지우고 `realtime.setAuth(null)`까지 await — UI가 바로 진행됩니다.
 * - `auth.signOut`(서버·클라이언트 정리)는 Auth API가 멈출 때가 있어 **블로킹하지 않고** 백그라운드에서만 시도합니다.
 */
const STORAGE_CLEAR_DEADLINE_MS = 3000;

function fireBestEffortRemoteSignOut(): void {
  void (async () => {
    for (const scope of ['local', 'global'] as const) {
      try {
        await Promise.race([
          supabase.auth.signOut({ scope }),
          new Promise<void>((r) => setTimeout(r, 12_000)),
        ]);
      } catch (e) {
        if (__DEV__) console.warn('[supabase] bestEffort signOut', { scope, e });
      }
    }
  })();
}

export async function signOutSupabase(): Promise<void> {
  const key = supabaseAuthStorageKeyFromUrl(supabaseUrl);
  const verifierKey = key ? `${key}-code-verifier` : null;

  try {
    await Promise.race([
      (async () => {
        if (key) await AsyncStorage.removeItem(key);
        if (verifierKey) await AsyncStorage.removeItem(verifierKey);
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('[supabase] AsyncStorage session key clear timeout')), STORAGE_CLEAR_DEADLINE_MS),
      ),
    ]);
  } catch (e) {
    if (__DEV__) console.warn('[supabase] signOutSupabase storage:', e instanceof Error ? e.message : e);
  }
  try {
    await Promise.race([
      supabase.realtime.setAuth(null),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('[supabase] realtime.setAuth(null) timeout')), 5000),
      ),
    ]);
  } catch (e) {
    if (__DEV__) console.warn('[supabase] signOutSupabase realtime:', e instanceof Error ? e.message : e);
  }

  fireBestEffortRemoteSignOut();
}

function sessionToLog(session: { user?: { id?: string; email?: string | null } } | null): Record<string, unknown> | null {
  const u = session?.user;
  if (!u) return null;
  return { id: u.id, email: u.email ?? null };
}

void (async () => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const t = session?.access_token ?? null;
    await supabase.realtime.setAuth(t);
    if (__DEV__) console.log('[supabase] realtime.setAuth(initial)', { hasToken: Boolean(t), user: sessionToLog(session) });
  } catch (e) {
    if (__DEV__) console.warn('[supabase] realtime.setAuth(initial) failed', e);
  }
})();

supabase.auth.onAuthStateChange(async (event, session) => {
  try {
    const t = session?.access_token ?? null;
    await supabase.realtime.setAuth(t);
    if (__DEV__)
      console.log('[supabase] realtime.setAuth(onAuthStateChange)', {
        event,
        hasToken: Boolean(t),
        user: sessionToLog(session),
      });
  } catch (e) {
    if (__DEV__) console.warn('[supabase] realtime.setAuth(onAuthStateChange) failed', e);
  }
});

/** 포그라운드 복귀 직후 Realtime JWT 갱신 — `transport failure` 재구독 성공률 개선 */
export async function refreshSupabaseRealtimeAuthFromSession(): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await supabase.realtime.setAuth(session?.access_token ?? null);
  } catch (e) {
    if (__DEV__) console.warn('[supabase] realtime.setAuth(foreground) failed', e);
  }
}

if (Platform.OS !== 'web') {
  let lastForegroundRealtimeAuthMs = 0;
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    const now = Date.now();
    if (now - lastForegroundRealtimeAuthMs < 2_500) return;
    lastForegroundRealtimeAuthMs = now;
    void refreshSupabaseRealtimeAuthFromSession();
  });
}
