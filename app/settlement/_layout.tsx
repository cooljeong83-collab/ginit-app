import { Stack } from 'expo-router';

import { GinitTheme } from '@/constants/ginit-theme';

export default function SettlementLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTintColor: GinitTheme.colors.text,
        contentStyle: { backgroundColor: GinitTheme.colors.bg },
      }}>
      <Stack.Screen name="accounts" options={{ headerShown: false, title: '정산 계좌' }} />
      <Stack.Screen name="account-edit" options={{ headerShown: false, title: '정산 계좌 등록' }} />
      <Stack.Screen name="[meetingId]" options={{ headerShown: false, title: '정산' }} />
    </Stack>
  );
}
