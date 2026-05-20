import { Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';

import { GinitTabBar } from '@/components/ginit';
import { ScreenTransitionSkeleton } from '@/components/ui';
import { useUserSession } from '@/src/context/UserSessionContext';
import { readAppIntroComplete } from '@/src/lib/onboarding-storage';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import { enforceAccountGate } from '@/src/features/account-suspension/enforce-account-gate';
import { useRecordAppActiveUser } from '@/src/hooks/use-record-app-active-user';
import { ensureUserProfile } from '@/src/lib/user-profile';

/*
 * === 백업: Firebase 익명 로그인 대기 후 탭 표시 ===
 * import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
 * import { GinitTheme } from '@/constants/ginit-theme';
 * import { getFirebaseAuth } from '@/src/lib/firebase';
 * import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
 * const [firebaseReady, setFirebaseReady] = useState(false);
 * useEffect(() => { ... signInAnonymously ... onAuthStateChanged ... }, [userId]);
 * if (!firebaseReady) return <ActivityIndicator ... />;
 */

export default function TabsLayout() {
  const router = useTransitionRouter();
  const { userId, authProfile, isHydrated, signOutSession } = useUserSession();
  const hasSession = Boolean(userId?.trim() || authProfile?.supabaseUserId?.trim());
  const hasSessionRef = useRef(hasSession);
  hasSessionRef.current = hasSession;
  const accountGateRanForRef = useRef<string | null>(null);

  useRecordAppActiveUser(userId);

  /** 스플래시에서 프로필 RPC가 실패해도 탭 진입 후 한 번 더 보강 */
  useEffect(() => {
    const id = userId?.trim();
    if (!id || !hasSession) return;
    void ensureUserProfile(id).catch(() => {
      /* 이후 프로필·모임 화면에서 재시도 */
    });
  }, [userId, hasSession]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!hasSession) {
      router.replace('/login');
    }
  }, [isHydrated, hasSession, router]);

  /** 이미 로그인된 상태에서 이용 중지된 경우 — 다음 탭 진입·포그라운드 방어 */
  useEffect(() => {
    const id = userId?.trim();
    if (!isHydrated || !id || !hasSession) return;
    if (accountGateRanForRef.current === id) return;
    accountGateRanForRef.current = id;
    void enforceAccountGate(id, { router, signOutSession });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1회/유저 PK
  }, [isHydrated, hasSession, userId]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!hasSession) return;
    void (async () => {
      try {
        const introSeen = await readAppIntroComplete();
        // effect cleanup에서 `router` 참조가 바뀌며 조기 취소되는 레이스를 피함 — 세션이 유지될 때만 온보딩으로 보냄
        if (!hasSessionRef.current) return;
        if (!introSeen) {
          router.replace({ pathname: '/onboarding', params: { next: 'tabs', flow: 'postLogin' } });
        }
      } catch {
        // 온보딩 스토리지 오류 시에도 UX는 안전하게 탭 진입을 유지합니다.
      }
    })();
    // router는 의도적으로 제외: 의존 시 불필요한 재실행·이전 async 취소로 온보딩 리다이렉트가 누락될 수 있음
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasSessionRef로 세션만 검증
  }, [isHydrated, hasSession]);

  if (!isHydrated || !hasSession) {
    return <ScreenTransitionSkeleton variant="list" />;
  }

  return (
    <Tabs
      tabBar={(props) => <GinitTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: '모임' }} />
      <Tabs.Screen name="map" options={{ title: '탐색' }} />
      <Tabs.Screen name="friends" options={{ title: '친구' }} />
      <Tabs.Screen name="chat" options={{ title: '채팅' }} />
      <Tabs.Screen name="profile" options={{ title: '프로필' }} />
    </Tabs>
  );
}
