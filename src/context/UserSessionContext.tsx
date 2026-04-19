import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { signOutGoogle } from '@/src/lib/google-sign-in';

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
  isHydrated: boolean;
  setPhoneUserId: (phoneUserId: string) => Promise<void>;
  signOutSession: () => Promise<void>;
  authProfile: AuthProfileSnapshot | null;
  setAuthProfile: (profile: AuthProfileSnapshot | null) => void;
};

const UserSessionContext = createContext<UserSessionContextValue | null>(null);

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const [phoneUserId, setPhoneState] = useState<string | null>(null);
  const [authProfile, setAuthProfileState] = useState<AuthProfileSnapshot | null>(null);
  const isHydrated = true;

  const setPhoneUserId = useCallback(async (id: string) => {
    setPhoneState(id);
  }, []);

  const setAuthProfile = useCallback((profile: AuthProfileSnapshot | null) => {
    setAuthProfileState(profile);
  }, []);

  const signOutSession = useCallback(async () => {
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
      signOutSession,
      authProfile,
      setAuthProfile,
    }),
    [phoneUserId, isHydrated, setPhoneUserId, signOutSession, authProfile, setAuthProfile],
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
