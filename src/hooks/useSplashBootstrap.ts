import { useCallback, useEffect, useRef, useState } from 'react';

import { useUserSession } from '@/src/context/UserSessionContext';
import { notifySplashReplacedToTabs } from '@/src/lib/splash-to-tabs-navigation';
import { normalizeUserId, readStoredUserId } from '@/src/lib/app-user-id';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import { isPhoneRegistered } from '@/src/lib/phone-registry';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { readSecureAuthSession } from '@/src/lib/secure-auth-session';
import { writeSecureGoogleSession } from '@/src/lib/secure-google-session';
import { enforceAccountGate } from '@/src/features/account-suspension/enforce-account-gate';
import { ensureUserProfile, resolveSessionUserIdFromVerifiedPhone } from '@/src/lib/user-profile';
import { supabase } from '@/src/lib/supabase';
import type { User } from '@supabase/supabase-js';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
  });
  return Promise.race([p.finally(() => (t ? clearTimeout(t) : undefined)), timeout]);
}

/** 부트는 막지 않음 — 홈·프로필 화면에서 `ensureUserProfile` 재시도 가능 */
async function tryEnsureProfileDuringBoot(pk: string): Promise<void> {
  try {
    await withTimeout(ensureUserProfile(pk), 10000, 'ensureUserProfile');
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn('[useSplashBootstrap] ensureUserProfile failed (continuing to app):', detail);
  }
}

function snapshotFromSupabaseUser(u: User) {
  const meta = u.user_metadata as Record<string, unknown> | undefined;
  const fullName =
    (typeof meta?.full_name === 'string' && meta.full_name) ||
    (typeof meta?.name === 'string' && meta.name) ||
    null;
  const avatar =
    (typeof meta?.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta?.picture === 'string' && meta.picture) ||
    null;
  return {
    displayName: fullName ?? u.email ?? null,
    email: u.email ?? null,
    photoUrl: avatar,
    supabaseUserId: u.id ?? null,
  };
}

/**
 * 앱 부트: Supabase 세션 / Secure 세션 / AsyncStorage 사용자 PK / 전화번호(레거시) → 회원 여부 확인 후 탭 또는 로그인으로 분기.
 */
export function useSplashBootstrap() {
  const router = useTransitionRouter();
  const { isHydrated, setUserId, clearStoredUserSession, setAuthProfile, signOutSession } =
    useUserSession();
  const [statusLabel, setStatusLabel] = useState('시작하는 중…');
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const finishedRef = useRef(false);

  const goTabs = useCallback(() => {
    router.replace('/(tabs)');
    notifySplashReplacedToTabs();
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

    const waitForSupabaseSessionOnce = async (): Promise<User | null> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) return session.user;
      return await withTimeout(
        new Promise<User | null>((resolve) => {
          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
              try {
                subscription.unsubscribe();
              } catch {
                /* noop */
              }
              resolve(session.user);
            }
          });
        }),
        4000,
        'supabaseAuthState',
      ).catch(() => null);
    };

    const canonicalizeStoredUserPk = async (raw: string): Promise<string> => {
      const t = raw.trim();
      if (!t) return '';
      if (t.includes('@')) return normalizeUserId(t) ?? t.toLowerCase().trim();
      const nPhone = normalizePhoneUserId(t) ?? t;
      const resolved = await resolveSessionUserIdFromVerifiedPhone(nPhone);
      return resolved ?? nPhone;
    };

    const tryEnterAsMember = async (userPk: string): Promise<boolean> => {
      setStatusLabel('회원 정보 확인 중…');
      const pk = await canonicalizeStoredUserPk(userPk);
      if (!pk) return false;
      const ok = await withTimeout(isPhoneRegistered(pk), 8000, 'isUserRegistered');
      if (cancelled) return false;
      if (!ok) return false;
      await setUserId(pk);
      await tryEnsureProfileDuringBoot(pk);
      if (cancelled) return false;
      const allowed = await enforceAccountGate(pk, { router, signOutSession });
      if (cancelled) return false;
      if (!allowed) {
        finishedRef.current = true;
        return true;
      }
      if (!cancelled) {
        finishedRef.current = true;
        goTabs();
      }
      return true;
    };

    void (async () => {
      try {
        setStatusLabel('세션 확인 중…');

        const supabaseUser = await waitForSupabaseSessionOnce();
        if (cancelled) return;
        if (supabaseUser) {
          setStatusLabel('로그인 상태 확인 중…');
          setAuthProfile(snapshotFromSupabaseUser(supabaseUser));
          void writeSecureGoogleSession({
            uid: supabaseUser.id,
            email: supabaseUser.email ?? null,
          });
          const emailNorm = supabaseUser.email ? normalizeUserId(supabaseUser.email) : null;
          let pk: string | null = emailNorm;
          try {
            const phoneRaw = supabaseUser.phone?.trim();
            if (phoneRaw) {
              const n = normalizePhoneUserId(phoneRaw);
              if (n) {
                const resolved = await resolveSessionUserIdFromVerifiedPhone(n);
                if (resolved) pk = resolved;
              }
            }
          } catch {
            /* 네트워크 등: 이메일 PK 유지 */
          }
          if (pk) {
            await setUserId(pk);
            await tryEnsureProfileDuringBoot(pk);
            if (cancelled) return;
            const allowed = await enforceAccountGate(pk, { router, signOutSession });
            if (cancelled) return;
            finishedRef.current = true;
            if (allowed) goTabs();
            return;
          }
          try {
            await clearStoredUserSession();
          } catch {
            /* noop */
          }
          finishedRef.current = true;
          goLogin();
          return;
        }

        const secure = await readSecureAuthSession();
        if (cancelled) return;
        if (secure?.userId?.trim()) {
          const pk = await canonicalizeStoredUserPk(secure.userId);
          if (!pk) {
            finishedRef.current = true;
            goLogin();
            return;
          }
          await setUserId(pk);
          await tryEnsureProfileDuringBoot(pk);
          if (cancelled) return;
          const allowed = await enforceAccountGate(pk, { router, signOutSession });
          if (cancelled) return;
          finishedRef.current = true;
          if (allowed) goTabs();
          return;
        }

        const stored = await readStoredUserId();
        if (cancelled) return;

        if (stored?.trim()) {
          if (await tryEnterAsMember(stored)) return;
          await clearStoredUserSession();
          if (cancelled) return;
          setHintMessage('저장된 계정은 더 이상 등록되지 않았어요. 다시 로그인해 주세요.');
          await new Promise((r) => setTimeout(r, 700));
          if (cancelled) return;
          setHintMessage(null);
        }

        setStatusLabel('준비 중…');
        finishedRef.current = true;
        goLogin();
      } catch (e) {
        if (cancelled) return;
        try {
          await clearStoredUserSession();
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
  }, [
    isHydrated,
    setUserId,
    clearStoredUserSession,
    setAuthProfile,
    signOutSession,
    router,
    goTabs,
    goLogin,
  ]);

  return {
    readyForUi: isHydrated,
    statusLabel,
    hintMessage,
  };
}
