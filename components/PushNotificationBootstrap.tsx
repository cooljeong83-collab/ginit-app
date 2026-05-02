import * as Device from 'expo-device';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { ensureGinitInAppAndroidChannel } from '@/src/lib/in-app-alarm-push';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import { isProfileFcmQuietHoursActive } from '@/src/lib/profile-settings-local';
import { markAlarmReadFromPushData, navigateFromPushData } from '@/src/lib/push-open-navigation';

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    try {
      if (await isProfileFcmQuietHoursActive()) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      const data = n?.request?.content?.data as Record<string, unknown> | undefined;
      const action = typeof data?.action === 'string' ? String(data.action).trim() : '';
      const meetingId = typeof data?.meetingId === 'string' ? String(data.meetingId).trim() : '';
      if (action === 'in_app_chat' && meetingId) {
        const notifyOn = await isMeetingChatNotifyEnabled(meetingId);
        if (!notifyOn) {
          return {
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          };
        }
      }
      if ((action === 'in_app_chat' || action === 'in_app_social_dm') && meetingId) {
        const cur = getCurrentChatRoomId();
        if (cur && cur === meetingId) {
          return {
            shouldShowBanner: false,
            shouldShowList: false,
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
