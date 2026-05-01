import { Stack } from 'expo-router';

import { GinitTheme } from '@/constants/ginit-theme';

export default function MeetingChatMeetingIdLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#f2f4f7' },
      }}>
      <Stack.Screen
        name="settings"
        options={{
          headerShown: true,
          title: '채팅방 설정',
          headerShadowVisible: false,
          headerTintColor: '#0f172a',
          contentStyle: { backgroundColor: GinitTheme.colors.bg },
        }}
      />
      <Stack.Screen
        name="members"
        options={{
          headerShown: true,
          title: '참여자',
          headerShadowVisible: false,
          headerTintColor: '#0f172a',
          contentStyle: { backgroundColor: GinitTheme.colors.bg },
        }}
      />
      <Stack.Screen
        name="media"
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: GinitTheme.colors.bg },
        }}
      />
    </Stack>
  );
}
