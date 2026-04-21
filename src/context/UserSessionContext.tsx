import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearStoredUserId, readStoredUserId, writeStoredUserId } from '@/src/lib/app-user-id';
import { signOutGoogle } from '@/src/lib/google-sign-in';
import { clearSecureAuthSession } from '@/src/lib/secure-auth-session';
import { clearSecureGoogleSession } from '@/src/lib/secure-google-session';
import { AuthService } from '@/src/services/AuthService';

/** 구글·Firebase에서 받은 표시용 프로필 (전역 세션 스냅샷) */
export type AuthProfileSnapshot = {
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
  firebaseUid: string | null;
  gender?: string | null;
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

  const setUserId = useCallback(async (id: string) => {
    const t = id.trim();
    setUserIdState(t);
    await writeStoredUserId(t);
  }, []);

  const clearStoredUserSession = useCallback(async () => {
    await clearStoredUserId();
    setUserIdState(null);
  }, []);

  const setAuthProfile = useCallback((profile: AuthProfileSnapshot | null) => {
    setAuthProfileState(profile);
  }, []);

  const signOutSession = useCallback(async () => {
    await clearStoredUserId();
    await clearSecureAuthSession();
    await clearSecureGoogleSession();
    setUserIdState(null);
    setAuthProfileState(null);
    try {
      await AuthService.signOut();
    } catch {
      /* Firebase 세션 없음 등 */
    }
    try {
      await signOutGoogle();
    } catch {
      /* Firebase/구글 세션 없음 등 */
    }
  }, []);

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
