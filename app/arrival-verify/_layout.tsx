import { Stack } from 'expo-router';

import { GinitTheme } from '@/constants/ginit-theme';

export default function ArrivalVerifyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerShadowVisible: false,
        headerTintColor: GinitTheme.colors.text,
        contentStyle: { backgroundColor: GinitTheme.colors.bg },
      }}>
      <Stack.Screen name="[meetingId]" options={{ headerShown: false, title: '장소 인증' }} />
    </Stack>
  );
}
