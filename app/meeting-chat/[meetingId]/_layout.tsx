import { Stack } from 'expo-router';

export default function MeetingChatMeetingIdLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#f2f4f7' },
      }}
    />
  );
}
