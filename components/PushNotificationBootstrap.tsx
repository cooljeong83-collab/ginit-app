import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { ensureGinitInAppAndroidChannel } from '@/src/lib/in-app-alarm-push';
import { getMeetingById } from '@/src/lib/meetings';
import { saveUserExpoPushToken } from '@/src/lib/user-expo-push-token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
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
  const actionAny = typeof (data as { action?: unknown }).action === 'string' ? String((data as { action: string }).action).trim() : '';
  if (actionAny === 'friend_request' || actionAny === 'follow_request') {
    router.push('/social/connections');
    return;
  }
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (meetingId && action === 'in_app_chat') {
    router.push(`/meeting-chat/${meetingId}`);
    return;
  }
  if (meetingId && action === 'in_app_meeting') {
    router.push(`/meeting/${meetingId}`);
    return;
  }
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

async function markAlarmReadFromPushData(
  data: Record<string, unknown> | undefined,
  syncMeetingAckFromMeeting: ReturnType<typeof useInAppAlarms>['syncMeetingAckFromMeeting'],
): Promise<void> {
  if (!data || typeof data !== 'object') return;
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  if (!meetingId) return;
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  // 채팅은 messageId가 없어서 여기서 정확한 read up to 처리는 어려움.
  // 모임 변경/상세 알람은 현재 모임 스냅샷으로 ack를 갱신해 읽음 처리합니다.
  const shouldAckMeeting =
    action === 'in_app_meeting' ||
    action === 'participant_joined' ||
    action === 'participant_left' ||
    action === 'host_transferred';
  if (!shouldAckMeeting) return;
  const m = await getMeetingById(meetingId);
  if (!m) return;
  syncMeetingAckFromMeeting(m);
}

/**
 * 푸시 권한·Expo 토큰 등록, 알림 탭 시 모임 상세(또는 삭제 시 홈)로 이동.
 */
export function PushNotificationBootstrap() {
  const router = useRouter();
  const { userId } = useUserSession();
  const { syncMeetingAckFromMeeting } = useInAppAlarms();
  const bootHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!userId?.trim()) return;

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
        await ensureGinitInAppAndroidChannel();
      }

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
      navigateFromPushData(router, data);
      void markAlarmReadFromPushData(data, syncMeetingAckFromMeeting);
    });
    return () => sub.remove();
  }, [router, syncMeetingAckFromMeeting]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (bootHandled.current) return;
    bootHandled.current = true;
    void (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = last.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromPushData(router, data);
      await markAlarmReadFromPushData(data, syncMeetingAckFromMeeting);
    })();
  }, [router, syncMeetingAckFromMeeting]);

  return null;
}
