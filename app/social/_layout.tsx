import { Stack } from 'expo-router';

export default function SocialStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTintColor: '#0f172a',
        contentStyle: { backgroundColor: '#F6FAFF' },
      }}>
      <Stack.Screen name="discovery" options={{ title: '지닛 디스커버리' }} />
      <Stack.Screen name="connections" options={{ title: 'My Connections' }} />
    </Stack>
  );
}
