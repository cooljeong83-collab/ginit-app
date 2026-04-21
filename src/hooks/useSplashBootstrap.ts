import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { fetchAndroidPhoneHint } from '@/src/lib/phone-hint';
import { isPhoneRegistered } from '@/src/lib/phone-registry';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId, readStoredPhoneUserId } from '@/src/lib/phone-user-id';
import { ensureUserProfile } from '@/src/lib/user-profile';

/**
 * 앱 부트: AsyncStorage 전화 → 기기 번호(안드로이드·권한) → 회원 여부 확인 후 탭 또는 로그인으로 분기.
 * 온보딩은 스플래시 경로에 포함하지 않습니다(회원가입 완료 후에만 표시).
 */
export function useSplashBootstrap() {
  const router = useRouter();
  const { isHydrated, setPhoneUserId, clearStoredPhoneSession } = useUserSession();
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

    const tryEnterAsMember = async (normalized: string): Promise<boolean> => {
      setStatusLabel('회원 정보 확인 중…');
      const ok = await isPhoneRegistered(normalized);
      if (cancelled) return false;
      if (!ok) return false;
      await setPhoneUserId(normalized);
      await ensureUserProfile(normalized);
      if (!cancelled) {
        finishedRef.current = true;
        goTabs();
      }
      return true;
    };

    void (async () => {
      setStatusLabel('세션 확인 중…');
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

      setStatusLabel(Platform.OS === 'android' ? '전화번호 확인 중…' : '준비 중…');
      let deviceRaw: string | null = null;
      if (Platform.OS === 'android') {
        setStatusLabel('전화번호 권한·기기 정보 확인 중…');
        deviceRaw = await fetchAndroidPhoneHint();
      }
      if (cancelled) return;

      let needHintPause = false;
      if (Platform.OS === 'android' && !deviceRaw) {
        setHintMessage('전화번호를 자동으로 읽을 수 없어요. 권한을 허용하거나 로그인 화면에서 입력해 주세요.');
        needHintPause = true;
      }

      const normalized = deviceRaw ? normalizePhoneUserId(deviceRaw) : null;
      if (normalized) {
        if (await tryEnterAsMember(normalized)) return;
        if (cancelled) return;
        finishedRef.current = true;
        goLogin({ phone: formatNormalizedPhoneKrDisplay(normalized) });
        return;
      }

      if (needHintPause) {
        await new Promise((r) => setTimeout(r, 800));
        if (cancelled) return;
      }
      finishedRef.current = true;
      goLogin();
    })();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, setPhoneUserId, clearStoredPhoneSession, goTabs, goLogin]);

  return {
    readyForUi: isHydrated,
    statusLabel,
    hintMessage,
  };
}
