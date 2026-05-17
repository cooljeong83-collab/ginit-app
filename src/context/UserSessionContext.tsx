import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearStoredUserId, readStoredUserId, writeStoredUserId } from '@/src/lib/app-user-id';
import { resetMeetingsSessionCaches } from '@/src/lib/meetings-session-cache-reset';
import { prefetchUserProfileCache } from '@/src/lib/user-profile-cache-sync';
import { clearPendingPushOpenPayload } from '@/src/lib/pending-push-navigation';
import { signOutGoogle } from '@/src/lib/google-sign-in';
import { readSecureAuthSession, clearSecureAuthSession } from '@/src/lib/secure-auth-session';
import { clearSecureGoogleSession } from '@/src/lib/secure-google-session';
import { supabase } from '@/src/lib/supabase';
import { startUserChatNotifications } from '@/src/lib/user-chat-notifications-runtime';
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

type UserSessionContextValue = {
  /** 앱 사용자 PK — 신규는 정규화 이메일, 레거시는 전화 E.164(+82…) */
  userId: string | null;
  /** AsyncStorage에서 `userId` 복원 완료 여부(부트 스플래시 전에 false) */
  isHydrated: boolean;
  setUserId: (userId: string) => Promise<void>;
  /** 저장된 사용자 PK만 제거(스플래시에서 불일치 시). 구글 로그아웃은 하지 않습니다. */
  clearStoredUserSession: () => Promise<void>;
  signOutSession: () => Promise<void>;
  authProfile: AuthProfileSnapshot | null;
  setAuthProfile: (profile: AuthProfileSnapshot | null) => void;
};

const UserSessionContext = createContext<UserSessionContextValue | null>(null);

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [userId, setUserIdState] = useState<string | null>(null);
  const [authProfile, setAuthProfileState] = useState<AuthProfileSnapshot | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stored = await readStoredUserId();
        if (alive && stored) setUserIdState(stored);
      } finally {
        if (alive) setIsHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!userId?.trim()) return;
    return startUserChatNotifications(userId.trim());
  }, [isHydrated, userId]);

  useEffect(() => {
    if (!isHydrated) return;
    const uid = userId?.trim();
    if (!uid) return;
    void prefetchUserProfileCache(queryClient, uid);
  }, [isHydrated, userId, queryClient]);

  const setUserId = useCallback(async (id: string) => {
    const t = id.trim();
    setUserIdState(t);
    await writeStoredUserId(t);
  }, []);

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
  const clearAllLocalAuthMirrors = useCallback(async () => {
    await clearStoredUserId();
    await withClearDeadline('clearSecureAuthSession', 8000, () => clearSecureAuthSession());
    await withClearDeadline('clearSecureGoogleSession', 8000, () => clearSecureGoogleSession());
    clearPendingPushOpenPayload();
    try {
      await resetMeetingsSessionCaches(queryClient);
    } catch (e) {
      if (__DEV__) {
        console.warn(
          '[UserSession] resetMeetingsSessionCaches:',
          e instanceof Error ? e.message : e,
        );
      }
    }
    setUserIdState(null);
    setAuthProfileState(null);
  }, [withClearDeadline, queryClient]);

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

  const signOutSession = useCallback(async () => {
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
    await clearAllLocalAuthMirrors();
    if (__DEV__) console.log('[UserSession] signOutSession → done');
  }, [clearAllLocalAuthMirrors]);

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
