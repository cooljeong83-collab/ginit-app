import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type UserSessionContextValue = {
  /** 정규화된 전화번호 PK (예: +821012345678) */
  phoneUserId: string | null;
  isHydrated: boolean;
  setPhoneUserId: (phoneUserId: string) => Promise<void>;
  signOutSession: () => Promise<void>;
};

const UserSessionContext = createContext<UserSessionContextValue | null>(null);

/*
 * === 백업: AsyncStorage 하이드레이션 + Firebase 익명 로그인 / signOut / 구글 연동 ===
 * import { useEffect } from 'react';
 * import { signInAnonymously, signOut } from 'firebase/auth';
 * import { getFirebaseAuth } from '@/src/lib/firebase';
 * import { signOutGoogle } from '@/src/lib/google-sign-in';
 * import { clearStoredPhoneUserId, readStoredPhoneUserId, writeStoredPhoneUserId } from '@/src/lib/phone-user-id';
 *
 * useEffect(() => {
 *   let alive = true;
 *   (async () => {
 *     const v = await readStoredPhoneUserId();
 *     if (alive) { setPhoneState(v); setHydrated(true); }
 *   })();
 *   return () => { alive = false; };
 * }, []);
 *
 * useEffect(() => {
 *   if (!isHydrated || !phoneUserId) return;
 *   const auth = getFirebaseAuth();
 *   if (auth.currentUser) return;
 *   void signInAnonymously(auth).catch(() => {});
 * }, [isHydrated, phoneUserId]);
 */

export function UserSessionProvider({ children }: { children: ReactNode }) {
  const [phoneUserId, setPhoneState] = useState<string | null>(null);
  const isHydrated = true;

  const setPhoneUserId = useCallback(async (id: string) => {
    setPhoneState(id);
    // await writeStoredPhoneUserId(id);
  }, []);

  const signOutSession = useCallback(async () => {
    setPhoneState(null);
    // await clearStoredPhoneUserId();
    // await signOutGoogle();
    // await signOut(getFirebaseAuth());
  }, []);

  const value = useMemo(
    () => ({
      phoneUserId,
      isHydrated,
      setPhoneUserId,
      signOutSession,
    }),
    [phoneUserId, isHydrated, setPhoneUserId, signOutSession],
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
