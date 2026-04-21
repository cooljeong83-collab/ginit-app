import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { signOutGoogle } from '@/src/lib/google-sign-in';
import { clearStoredPhoneUserId, readStoredPhoneUserId, writeStoredPhoneUserId } from '@/src/lib/phone-user-id';

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
  /** 정규화된 전화번호 PK (예: +821012345678) */
  phoneUserId: string | null;
  /** AsyncStorage에서 `phoneUserId` 복원 완료 여부(부트 스플래시 전에 false) */
  isHydrated: boolean;
  setPhoneUserId: (phoneUserId: string) => Promise<void>;
  /** 저장된 전화 세션만 제거(스플래시에서 불일치 시). 구글 로그아웃은 하지 않습니다. */
  clearStoredPhoneSession: () => Promise<void>;
  signOutSession: () => Promise<void>;
  authProfile: AuthProfileSnapshot | null;
  setAuthProfile: (profile: AuthProfileSnapshot | null) => void;
};

const UserSessionContext = createContext<UserSessionContextValue | null>(null);

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const [phoneUserId, setPhoneState] = useState<string | null>(null);
  const [authProfile, setAuthProfileState] = useState<AuthProfileSnapshot | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const stored = await readStoredPhoneUserId();
        if (alive && stored) setPhoneState(stored);
      } finally {
        if (alive) setIsHydrated(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setPhoneUserId = useCallback(async (id: string) => {
    const t = id.trim();
    setPhoneState(t);
    await writeStoredPhoneUserId(t);
  }, []);

  const clearStoredPhoneSession = useCallback(async () => {
    await clearStoredPhoneUserId();
    setPhoneState(null);
  }, []);

  const setAuthProfile = useCallback((profile: AuthProfileSnapshot | null) => {
    setAuthProfileState(profile);
  }, []);

  const signOutSession = useCallback(async () => {
    await clearStoredPhoneUserId();
    setPhoneState(null);
    setAuthProfileState(null);
    try {
      await signOutGoogle();
    } catch {
      /* Firebase/구글 세션 없음 등 */
    }
  }, []);

  const value = useMemo(
    () => ({
      phoneUserId,
      isHydrated,
      setPhoneUserId,
      clearStoredPhoneSession,
      signOutSession,
      authProfile,
      setAuthProfile,
    }),
    [phoneUserId, isHydrated, setPhoneUserId, clearStoredPhoneSession, signOutSession, authProfile, setAuthProfile],
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
