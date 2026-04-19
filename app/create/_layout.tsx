import { Stack } from 'expo-router';
import { Platform } from 'react-native';

export default function CreateLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        ...(Platform.OS === 'android' ? { animationMatchesGesture: true } : {}),
      }}
    />
  );
}
