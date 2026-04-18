import { Stack } from 'expo-router';

import { UserSessionProvider } from '@/src/context/UserSessionContext';

/**
 * 루트에서는 과거 이슈가 있던 다음을 사용하지 않습니다.
 * - `expo-splash-screen`에서의 선제 `hideAsync` 연쇄
 * - 루트 렌더 경로의 `getFirebaseAuth()` 등 Firebase 초기화
 * - `react-native-device-info` 등 기기 식별 네이티브 호출
 *
 * 전역 유저는 `UserSessionContext`의 하드코딩 테스트 값으로 즉시 제공됩니다.
 * (복구 시 참고용 백업)
 *
 * ```tsx
 * import * as SplashScreen from 'expo-splash-screen';
 * import { useLayoutEffect } from 'react';
 * import { getFirebaseAuth } from '@/src/lib/firebase';
 * export default function RootLayout() {
 *   useLayoutEffect(() => { void SplashScreen.hideAsync(); }, []);
 *   try { getFirebaseAuth(); } catch { ... }
 *   return ( ... );
 * }
 * ```
 */
export default function RootLayout() {
  return (
    <UserSessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </UserSessionProvider>
  );
}
