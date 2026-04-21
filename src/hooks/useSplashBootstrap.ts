import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useUserSession } from '@/src/context/UserSessionContext';
import { getFirebaseAuth } from '@/src/lib/firebase';
import { isPhoneRegistered } from '@/src/lib/phone-registry';
import { normalizePhoneUserId, readStoredPhoneUserId } from '@/src/lib/phone-user-id';
import { readSecureAuthSession } from '@/src/lib/secure-auth-session';
import { writeSecureGoogleSession } from '@/src/lib/secure-google-session';
import { ensureUserProfile } from '@/src/lib/user-profile';
import { onAuthStateChanged, type User } from 'firebase/auth';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
  });
  return Promise.race([p.finally(() => (t ? clearTimeout(t) : undefined)), timeout]);
}

/**
 * 앱 부트: AsyncStorage 전화 → 기기 번호(안드로이드·권한) → 회원 여부 확인 후 탭 또는 로그인으로 분기.
 * 온보딩은 스플래시 경로에 포함하지 않습니다(회원가입 완료 후에만 표시).
 */
export function useSplashBootstrap() {
  const router = useRouter();
  const { isHydrated, setPhoneUserId, clearStoredPhoneSession, setAuthProfile } = useUserSession();
  const [statusLabel, setStatusLabel] = useState('시작하는 중…');
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const finishedRef = useRef(false);

  const goTabs = useCallback(() => {
    router.replace('/(tabs)');
  }, [router]);

  const goLogin = useCallback(
    (params?: { phone?: string }) => {
      if (params?.phone) {
        router.replace({ pathname: '/login', params: { phone: params.phone } });
      } else {
        router.replace('/login');
      }
    },
    [router],
  );

  useEffect(() => {
    if (!isHydrated || finishedRef.current) return;
    let cancelled = false;

    const snapshotFromFirebaseUser = (u: User) => ({
      displayName: u.displayName ?? null,
      email: u.email ?? null,
      photoUrl: u.photoURL ?? null,
      firebaseUid: u.uid ?? null,
    });

    const waitForFirebaseAuthOnce = async (): Promise<User | null> => {
      const a = getFirebaseAuth();
      if (a.currentUser) return a.currentUser;
      return await withTimeout(
        new Promise<User | null>((resolve) => {
          const unsub = onAuthStateChanged(a, (u) => {
            try {
              unsub();
            } catch {
              /* noop */
            }
            resolve(u);
          });
        }),
        4000,
        'firebaseAuthState',
      ).catch(() => null);
    };

    const tryEnterAsMember = async (normalized: string): Promise<boolean> => {
      setStatusLabel('회원 정보 확인 중…');
      const ok = await withTimeout(isPhoneRegistered(normalized), 8000, 'isPhoneRegistered');
      if (cancelled) return false;
      if (!ok) return false;
      await setPhoneUserId(normalized);
      await withTimeout(ensureUserProfile(normalized), 10000, 'ensureUserProfile');
      if (!cancelled) {
        finishedRef.current = true;
        goTabs();
      }
      return true;
    };

    void (async () => {
      try {
        setStatusLabel('세션 확인 중…');

        // 0) Firebase Auth(구글) 세션이 있으면 자동 로그인 → 홈 진입
        const firebaseUser = await waitForFirebaseAuthOnce();
        if (cancelled) return;
        if (firebaseUser && !firebaseUser.isAnonymous) {
          setStatusLabel('로그인 상태 확인 중…');
          setAuthProfile(snapshotFromFirebaseUser(firebaseUser));
          void writeSecureGoogleSession({ uid: firebaseUser.uid, email: firebaseUser.email ?? null });
          finishedRef.current = true;
          goTabs();
          return;
        }

        // 1) SecureStore 세션이 있으면 즉시 홈 진입 (당근마켓식)
        const secure = await readSecureAuthSession();
        if (cancelled) return;
        if (secure?.phoneUserId?.trim()) {
          const n = normalizePhoneUserId(secure.phoneUserId) ?? secure.phoneUserId.trim();
          await setPhoneUserId(n);
          await withTimeout(ensureUserProfile(n), 10000, 'ensureUserProfile');
          if (!cancelled) {
            finishedRef.current = true;
            goTabs();
          }
          return;
        }

        const stored = await readStoredPhoneUserId();
        if (cancelled) return;

        if (stored?.trim()) {
          const n = normalizePhoneUserId(stored) ?? stored.trim();
          if (await tryEnterAsMember(n)) return;
          await clearStoredPhoneSession();
          if (cancelled) return;
          setHintMessage('저장된 번호는 더 이상 등록되지 않았어요. 다시 로그인해 주세요.');
          await new Promise((r) => setTimeout(r, 700));
          if (cancelled) return;
          setHintMessage(null);
        }

        setStatusLabel('준비 중…');
        finishedRef.current = true;
        goLogin();
      } catch (e) {
        if (cancelled) return;
        // 부트 중 예외/네트워크 지연으로 스플래시에 갇히는 것을 방지: 항상 로그인으로 폴백.
        try {
          await clearStoredPhoneSession();
        } catch {
          /* noop */
        }
        const msg = e instanceof Error ? e.message : '알 수 없는 오류';
        setHintMessage(`초기화 중 문제가 발생했어요. 로그인 화면으로 이동합니다.\n(${msg})`);
        await new Promise((r) => setTimeout(r, 900));
        if (cancelled) return;
        setHintMessage(null);
        finishedRef.current = true;
        goLogin();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, setPhoneUserId, clearStoredPhoneSession, setAuthProfile, goTabs, goLogin]);

  return {
    readyForUi: isHydrated,
    statusLabel,
    hintMessage,
  };
}
