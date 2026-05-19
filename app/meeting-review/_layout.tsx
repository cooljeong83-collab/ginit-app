import { Stack } from 'expo-router';

import { GinitTheme } from '@/constants/ginit-theme';

export default function MeetingReviewLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: GinitTheme.colors.bg },
      }}>
      <Stack.Screen name="[meetingId]" options={{ title: '장소 리뷰' }} />
    </Stack>
  );
}
