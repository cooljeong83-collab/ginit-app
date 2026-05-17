import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { clearStoredUserId, readStoredUserId, writeStoredUserId } from '@/src/lib/app-user-id';
import { requestAppExit } from '@/src/lib/exit-app';
import { purgeSignOutSessionCaches } from '@/src/lib/meetings-session-cache-reset';
import { runPostLoginLocalHydration } from '@/src/lib/post-login-local-hydration';
import { clearPendingPushOpenPayload } from '@/src/lib/pending-push-navigation';
import { signOutGoogle } from '@/src/lib/google-sign-in';
import { readSecureAuthSession, clearSecureAuthSession } from '@/src/lib/secure-auth-session';
import { clearSecureGoogleSession } from '@/src/lib/secure-google-session';
import { supabase } from '@/src/lib/supabase';
import { startUserChatNotifications } from '@/src/lib/user-chat-notifications-runtime';
import { applyDeferredWatermelonPurgeIfNeeded } from '@/src/lib/watermelon-db-files';
import { AuthService } from '@/src/services/AuthService';

/** Supabase Auth·OAuth에서 받은 표시용 프로필 (전역 세션 스냅샷) */
export type AuthProfileSnapshot = {
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
  /** Supabase Auth `auth.users.id` (UUID) */
  supabaseUserId: string | null;
  gender?: string | null;
  /** 회원가입 시 선택 연령대 코드 예: `TEENS`, `TWENTIES` … */
  ageBand?: string | null;
  birthYear?: number | null;
};

export type SignOutSessionOptions = {
  /** true면 세션·캐시 정리 후 Android 프로세스 kill. 기본 false — 가입 실패 정리 등 */
  exitApp?: boolean;
};

type ClearAllLocalAuthMirrorsOptions = {
  /** `signOutSession` 경로 — `getSession()` 락 대기 없이 purge 진행 */
  fromSignOut?: boolean;
  /** Android kill 직전 Watermelon 파일 삭제를 다음 콜드 스타트로 미룸 */
  deferWatermelonToNextLaunch?: boolean;
};

const CLEAR_MIRRORS_WAIT_MS = 8_000;
const CLEAR_MIRRORS_GET_SESSION_MS = 2_000;
const SIGN_OUT_CLEAR_DEADLINE_MS = 10_000;

type UserSessionContextValue = {
  /** 앱 사용자 PK — 신규는 정규화 이메일, 레거시는 전화 E.164(+82…) */
  userId: string | null;
  /** AsyncStorage에서 `userId` 복원 완료 여부(부트 스플래시 전에 false) */
  isHydrated: boolean;
  setUserId: (userId: string) => Promise<void>;
  /** 저장된 사용자 PK만 제거(스플래시에서 불일치 시). 구글 로그아웃은 하지 않습니다. */
  clearStoredUserSession: () => Promise<void>;
  signOutSession: (options?: SignOutSessionOptions) => Promise<void>;
  authProfile: AuthProfileSnapshot | null;
  setAuthProfile: (profile: AuthProfileSnapshot | null) => void;
};

const UserSessionContext = createContext<UserSessionContextValue | null>(null);

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [userId, setUserIdState] = useState<string | null>(null);
  const [authProfile, setAuthProfileState] = useState<AuthProfileSnapshot | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  /** `signOutSession`이 purge 중일 때 늦은 SIGNED_OUT이 중복 purge·WM 데드락을 유발하지 않게 함 */
  const signOutSessionInFlightRef = useRef(false);
  const clearMirrorsInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await applyDeferredWatermelonPurgeIfNeeded();
        const stored = await readStoredUserId();
        if (alive && stored?.trim()) {
          const pk = stored.trim();
          setUserIdState(pk);
          void runPostLoginLocalHydration(pk, queryClient);
        }
      } finally {
        if (alive) setIsHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [queryClient]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!userId?.trim()) return;
    return startUserChatNotifications(userId.trim());
  }, [isHydrated, userId]);

  const setUserId = useCallback(
    async (id: string) => {
      const t = id.trim();
      const prev = userId?.trim() ?? '';
      setUserIdState(t);
      await writeStoredUserId(t);
      if (t && t !== prev) {
        void runPostLoginLocalHydration(t, queryClient);
      }
    },
    [queryClient, userId],
  );

  const clearStoredUserSession = useCallback(async () => {
    await clearStoredUserId();
    setUserIdState(null);
  }, []);

  /** SecureStore가 일부 기기에서 오래 걸릴 수 있어 로그아웃 전체가 멈추지 않게 상한을 둡니다. */
  const withClearDeadline = useCallback(async (label: string, ms: number, op: () => Promise<void>) => {
    try {
      await Promise.race([
        op(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms),
        ),
      ]);
    } catch (e) {
      if (__DEV__) console.warn('[UserSession] clear mirror:', e instanceof Error ? e.message : e);
    }
  }, []);

  /** Supabase 세션 종료·불일치 시 로컬 PK·secure·푸시 펜딩을 한 번에 비웁니다(레거시 secure-only 경로는 별도 가드). */
  const clearAllLocalAuthMirrors = useCallback(
    async (opts?: ClearAllLocalAuthMirrorsOptions) => {
      if (clearMirrorsInFlightRef.current) {
        await Promise.race([
          clearMirrorsInFlightRef.current,
          new Promise<void>((resolve) => setTimeout(resolve, CLEAR_MIRRORS_WAIT_MS)),
        ]);
        if (clearMirrorsInFlightRef.current) {
          if (__DEV__) {
            console.warn('[UserSession] clearAllLocalAuthMirrors: prior run still in flight, starting new run');
          }
          clearMirrorsInFlightRef.current = null;
        }
      }

      const run = async () => {
        if (__DEV__) console.log('[UserSession] clearAllLocalAuthMirrors → run start', opts ?? {});

        if (!opts?.fromSignOut) {
          const sessionResult = await Promise.race([
            supabase.auth.getSession(),
            new Promise<{ data: { session: null } }>((resolve) =>
              setTimeout(
                () => resolve({ data: { session: null } }),
                CLEAR_MIRRORS_GET_SESSION_MS,
              ),
            ),
          ]);
          if (sessionResult.data.session?.user) {
            /** 재로그인 직후 늦게 도착한 SIGNED_OUT — 새 세션 로컬 데이터를 지우지 않음 */
            if (__DEV__) console.log('[UserSession] clearAllLocalAuthMirrors → skip (active session)');
            return;
          }
        }

        setUserIdState(null);
        setAuthProfileState(null);

        try {
          await purgeSignOutSessionCaches(queryClient, {
            deferWatermelonToNextLaunch: opts?.deferWatermelonToNextLaunch,
          });
        } catch (e) {
          if (__DEV__) {
            console.warn(
              '[UserSession] purgeSignOutSessionCaches:',
              e instanceof Error ? e.message : e,
            );
          }
        }

        await clearStoredUserId();
        await withClearDeadline('clearSecureAuthSession', 8000, () => clearSecureAuthSession());
        await withClearDeadline('clearSecureGoogleSession', 8000, () => clearSecureGoogleSession());
        if (__DEV__) console.log('[UserSession] clearAllLocalAuthMirrors → run done');
      };

      clearMirrorsInFlightRef.current = run().finally(() => {
        clearMirrorsInFlightRef.current = null;
      });
      await clearMirrorsInFlightRef.current;
    },
    [withClearDeadline, queryClient],
  );

  const setAuthProfile = useCallback((profile: AuthProfileSnapshot | null) => {
    setAuthProfileState(profile);
  }, []);

  useEffect(() => {
    let alive = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!alive) return;
      if (event !== 'SIGNED_OUT') return;
      if (signOutSessionInFlightRef.current) return;
      if (session?.user) return;
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      if (current?.user) {
        /** 로그아웃 직후 바로 재로그인하면 SIGNED_OUT 콜백이 SIGNED_IN 뒤에 늦게 올 수 있음 */
        return;
      }
      await clearAllLocalAuthMirrors();
    });
    return () => {
      alive = false;
      try {
        subscription.unsubscribe();
      } catch {
        /* noop */
      }
    };
  }, [clearAllLocalAuthMirrors]);

  /** 하이드레이션 직후: Supabase 세션 없고 secure도 없는데 저장 PK만 남은 경우(세션 만료·크래시 등) 정리 */
  useEffect(() => {
    if (!isHydrated) return;
    let cancelled = false;
    void (async () => {
      const [{ data: { session } }, secure] = await Promise.all([
        supabase.auth.getSession(),
        readSecureAuthSession(),
      ]);
      if (cancelled) return;
      if (session?.user) return;
      if (!userId?.trim()) return;
      if (secure?.userId?.trim()) return;
      const {
        data: { session: again },
      } = await supabase.auth.getSession();
      if (again?.user) return;
      await clearAllLocalAuthMirrors();
    })();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, userId, clearAllLocalAuthMirrors]);

  const signOutSession = useCallback(
    async (options?: SignOutSessionOptions) => {
      signOutSessionInFlightRef.current = true;
      const shouldExitApp = Boolean(options?.exitApp);
      try {
        if (__DEV__) console.log('[UserSession] signOutSession → signOutGoogle');
        try {
          await signOutGoogle();
        } catch {
          /* 네이티브 Google SDK 정리 실패 등 — Supabase 로그아웃은 계속 진행 */
        }
        if (__DEV__) console.log('[UserSession] signOutSession → AuthService.signOut');
        try {
          await AuthService.signOut();
        } catch {
          /* 세션 없음 등 */
        }
        if (__DEV__) console.log('[UserSession] signOutSession → clearAllLocalAuthMirrors');
        await Promise.race([
          clearAllLocalAuthMirrors({
            fromSignOut: true,
            deferWatermelonToNextLaunch: shouldExitApp,
          }),
          new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_CLEAR_DEADLINE_MS)),
        ]);
        if (__DEV__) console.log('[UserSession] signOutSession → done');
      } finally {
        signOutSessionInFlightRef.current = false;
        if (shouldExitApp) {
          if (__DEV__) console.log('[UserSession] signOutSession → requestAppExit');
          await requestAppExit();
        }
      }
    },
    [clearAllLocalAuthMirrors],
  );

  const value = useMemo(
    () => ({
      userId,
      isHydrated,
      setUserId,
      clearStoredUserSession,
      signOutSession,
      authProfile,
      setAuthProfile,
    }),
    [userId, isHydrated, setUserId, clearStoredUserSession, signOutSession, authProfile, setAuthProfile],
  );

  return <UserSessionContext.Provider value={value}>{children}</UserSessionContext.Provider>;
}

export function useUserSession(): UserSessionContextValue {
  const v = useContext(UserSessionContext);
  if (!v) {
    throw new Error('useUserSession must be used within UserSessionProvider');
  }
  return v;
}
