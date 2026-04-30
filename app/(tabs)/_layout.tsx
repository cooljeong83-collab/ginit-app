import { Tabs, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { GinitTabBar } from '@/components/ginit';
import { useUserSession } from '@/src/context/UserSessionContext';
import { readAppIntroComplete } from '@/src/lib/onboarding-storage';
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
  const router = useRouter();
  const { userId, authProfile, isHydrated } = useUserSession();
  const hasSession = Boolean(userId?.trim() || authProfile?.firebaseUid?.trim());
  const hasSessionRef = useRef(hasSession);
  hasSessionRef.current = hasSession;

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
    return null;
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
