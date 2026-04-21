import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';

import { PushNotificationBootstrap } from '@/components/PushNotificationBootstrap';
import { InAppAlarmsProvider } from '@/src/context/InAppAlarmsContext';
import { UserSessionProvider } from '@/src/context/UserSessionContext';

/** 네이티브 스플래시가 JS 부트 화면과 맞물릴 때까지 유지 → `SplashBootstrapScreen`에서 hideAsync */
void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * 전역 유저는 `UserSessionContext`(전화 PK, 구글 프로필 스냅샷)로 제공됩니다.
 * 스플래시: `preventAutoHideAsync` + `SplashBootstrapScreen` 첫 레이아웃에서 `hideAsync` (이중 전환 방지).
 */
export default function RootLayout() {
  return (
    <UserSessionProvider>
      <InAppAlarmsProvider>
        <PushNotificationBootstrap />
        <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F6FAFF' },
          freezeOnBlur: true,
          animation: 'slide_from_right',
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          ...(Platform.OS === 'android' ? { animationMatchesGesture: true } : {}),
        }}
      />
      </InAppAlarmsProvider>
    </UserSessionProvider>
  );
}
