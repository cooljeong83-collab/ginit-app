import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { GinitTabBar } from '@/components/ginit';
import { useUserSession } from '@/src/context/UserSessionContext';
import { readAppIntroComplete } from '@/src/lib/onboarding-storage';

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

  useEffect(() => {
    if (!isHydrated) return;
    if (!hasSession) {
      router.replace('/login');
    }
  }, [isHydrated, hasSession, router]);

  useEffect(() => {
    if (!isHydrated) return;
    if (!hasSession) return;
    let alive = true;
    (async () => {
      try {
        const introSeen = await readAppIntroComplete();
        if (!alive) return;
        if (!introSeen) {
          router.replace({ pathname: '/onboarding', params: { next: 'tabs', flow: 'postLogin' } });
        }
      } catch {
        // 온보딩 스토리지 오류 시에도 UX는 안전하게 탭 진입을 유지합니다.
      }
    })();
    return () => {
      alive = false;
    };
  }, [isHydrated, hasSession, router]);

  if (!isHydrated || !hasSession) {
    return null;
  }

  return (
    <Tabs
      tabBar={(props) => <GinitTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tabs.Screen name="index" options={{ title: '홈' }} />
      <Tabs.Screen name="map" options={{ title: '지도' }} />
      <Tabs.Screen name="chat" options={{ title: '채팅' }} />
      <Tabs.Screen name="profile" options={{ title: '프로필' }} />
    </Tabs>
  );
}
