import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { GinitTabBar } from '@/components/ginit';
import { useUserSession } from '@/src/context/UserSessionContext';

/*
 * === 백업: Firebase 익명 로그인 대기 후 탭 표시 ===
 * import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
 * import { GinitTheme } from '@/constants/ginit-theme';
 * import { getFirebaseAuth } from '@/src/lib/firebase';
 * import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
 * const [firebaseReady, setFirebaseReady] = useState(false);
 * useEffect(() => { ... signInAnonymously ... onAuthStateChanged ... }, [phoneUserId]);
 * if (!firebaseReady) return <ActivityIndicator ... />;
 */

export default function TabsLayout() {
  const router = useRouter();
  const { phoneUserId, isHydrated } = useUserSession();

  useEffect(() => {
    if (!isHydrated) return;
    if (!phoneUserId) {
      router.replace('/login');
    }
  }, [isHydrated, phoneUserId, router]);

  if (!isHydrated || !phoneUserId) {
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
