import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { ensureGinitInAppAndroidChannel } from '@/src/lib/in-app-alarm-push';
import { markAlarmReadFromPushData, navigateFromPushData } from '@/src/lib/push-open-navigation';
import { saveUserExpoPushToken } from '@/src/lib/user-expo-push-token';

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    try {
      const data = n?.request?.content?.data as Record<string, unknown> | undefined;
      const action = typeof data?.action === 'string' ? String(data.action).trim() : '';
      const meetingId = typeof data?.meetingId === 'string' ? String(data.meetingId).trim() : '';
      if ((action === 'in_app_chat' || action === 'in_app_social_dm') && meetingId) {
        const cur = getCurrentChatRoomId();
        if (cur && cur === meetingId) {
          return {
            shouldShowBanner: false,
            shouldShowList: false,
            // Android: shouldPlaySound false면 배너 자체가 안 뜨는 동작이 있어, 숨김은 배너 플래그만으로 처리합니다.
            shouldPlaySound: true,
            shouldSetBadge: false,
          };
        }
      }
    } catch {
      /* ignore */
    }
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

/**
 * 푸시 권한·Expo 토큰 등록, 알림 탭 시 모임 상세(또는 삭제 시 홈)로 이동.
 */
export function PushNotificationBootstrap() {
  const router = useRouter();
  const pathname = usePathname();
  const { userId } = useUserSession();
  const { markMeetingAlarmsReadByPushTap, markFriendRequestAlarmDismissed, markFriendAcceptedAlarmDismissed } =
    useInAppAlarms();
  const bootHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!userId?.trim()) return;

    (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowDisplayInCarPlay: true,
          },
        });
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 220],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
        await ensureGinitInAppAndroidChannel();
      }

      if (!Device.isDevice) return;

      const projectId =
        (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
        (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

      try {
        const tokenRes = projectId
          ? await Notifications.getExpoPushTokenAsync({ projectId })
          : await Notifications.getExpoPushTokenAsync();
        const token = tokenRes.data?.trim();
        if (token) await saveUserExpoPushToken(userId, token);
      } catch {
        /* 시뮬레이터·EAS projectId 미설정 등 */
      }
    })();
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      // 일부 환경에서 "수신" 단계에서 response가 호출되는 케이스를 방어:
      // 실제 사용자 탭(기본 액션)일 때만 네비게이션을 수행합니다.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        return;
      }
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromPushData(router, data, { replace: true, currentPathname: pathname });
      void markAlarmReadFromPushData(
        data,
        markMeetingAlarmsReadByPushTap,
        markFriendRequestAlarmDismissed,
        markFriendAcceptedAlarmDismissed,
      );
    });
    return () => sub.remove();
  }, [
    router,
    markMeetingAlarmsReadByPushTap,
    markFriendRequestAlarmDismissed,
    markFriendAcceptedAlarmDismissed,
    pathname,
  ]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (bootHandled.current) return;
    bootHandled.current = true;
    void (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = last.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromPushData(router, data, { replace: true, currentPathname: pathname });
      await markAlarmReadFromPushData(
        data,
        markMeetingAlarmsReadByPushTap,
        markFriendRequestAlarmDismissed,
        markFriendAcceptedAlarmDismissed,
      );
    })();
  }, [
    router,
    markMeetingAlarmsReadByPushTap,
    markFriendRequestAlarmDismissed,
    markFriendAcceptedAlarmDismissed,
    pathname,
  ]);

  return null;
}
