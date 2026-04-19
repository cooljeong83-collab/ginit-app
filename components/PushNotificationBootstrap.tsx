import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useUserSession } from '@/src/context/UserSessionContext';
import { saveUserExpoPushToken } from '@/src/lib/user-expo-push-token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function navigateFromPushData(
  router: ReturnType<typeof useRouter>,
  data: Record<string, unknown> | undefined,
): void {
  if (!data || typeof data !== 'object') return;
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const action = typeof data.action === 'string' ? data.action : '';
  if (!meetingId) {
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    if (url) void Linking.openURL(url);
    return;
  }
  if (action === 'deleted') {
    router.replace('/(tabs)');
    return;
  }
  router.push(`/meeting/${meetingId}`);
}

/**
 * 푸시 권한·Expo 토큰 등록, 알림 탭 시 모임 상세(또는 삭제 시 홈)로 이동.
 */
export function PushNotificationBootstrap() {
  const router = useRouter();
  const { phoneUserId } = useUserSession();
  const bootHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!phoneUserId?.trim()) return;

    (async () => {
      if (!Device.isDevice) return;

      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const projectId =
        (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
        (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

      try {
        const tokenRes = projectId
          ? await Notifications.getExpoPushTokenAsync({ projectId })
          : await Notifications.getExpoPushTokenAsync();
        const token = tokenRes.data?.trim();
        if (token) await saveUserExpoPushToken(phoneUserId, token);
      } catch {
        /* 시뮬레이터·EAS projectId 미설정 등 */
      }
    })();
  }, [phoneUserId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromPushData(router, data);
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (bootHandled.current) return;
    bootHandled.current = true;
    void (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      const data = last.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromPushData(router, data);
    })();
  }, [router]);

  return null;
}
