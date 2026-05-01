import { Stack } from 'expo-router';

export default function SocialStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTintColor: '#0f172a',
        contentStyle: { backgroundColor: '#FFFFFF' },
      }}>
      <Stack.Screen name="discovery" options={{ title: '지닛 디스커버리' }} />
      <Stack.Screen name="connections" options={{ title: 'My Connections' }} />
      <Stack.Screen name="friends-settings" options={{ title: '친구 관리' }} />
      <Stack.Screen name="hidden-friends" options={{ title: '숨긴 친구' }} />
      <Stack.Screen name="blocked-friends" options={{ title: '차단 친구' }} />
    </Stack>
  );
}
