import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { PushNotificationBootstrap } from '@/components/PushNotificationBootstrap';
import { TransientBottomMessageHost } from '@/components/ui/TransientBottomMessage';
import { AppPoliciesProvider } from '@/src/context/AppPoliciesContext';
import { InAppAlarmsProvider } from '@/src/context/InAppAlarmsContext';
import { QueryClientPersistProvider } from '@/src/context/QueryClientPersistProvider';
import { UserSessionProvider } from '@/src/context/UserSessionContext';

/**
 * 릴리스(프로덕션)에서는 과도한 console.* 호출이 JS 스레드를 점유해
 * 장시간 실행 시 체감 성능 저하로 이어질 수 있어, 정보성 로그를 비활성화합니다.
 * - error는 유지(크래시/리포팅 용도)
 */
let didDisableConsoleInProd = false;
if (!__DEV__ && !didDisableConsoleInProd) {
  didDisableConsoleInProd = true;
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
}

/**
 * 네이티브 스플래시가 JS 부트 화면과 맞물릴 때까지 유지 → `SplashBootstrapScreen`에서 hideAsync
 * - 웹: keep-awake 미지원 → `Unable to activate keep awake` 방지
 * - Strict Mode 등으로 이 파일이 두 번 평가될 때 중복 호출 방지
 */
let didScheduleSplashPrevent = false;
if (Platform.OS !== 'web' && !didScheduleSplashPrevent) {
  didScheduleSplashPrevent = true;
  void SplashScreen.preventAutoHideAsync().catch(() => {});
}

/**
 * 전역 유저는 `UserSessionContext`(전화 PK, 구글 프로필 스냅샷)로 제공됩니다.
 * 스플래시: `preventAutoHideAsync` + `SplashBootstrapScreen` 첫 레이아웃에서 `hideAsync` (이중 전환 방지).
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      <AppPoliciesProvider>
        <QueryClientPersistProvider>
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
              <TransientBottomMessageHost />
            </InAppAlarmsProvider>
          </UserSessionProvider>
        </QueryClientPersistProvider>
      </AppPoliciesProvider>
    </GestureHandlerRootView>
  );
}
