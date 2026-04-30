import {
  getInitialNotification,
  getMessaging,
  onNotificationOpenedApp,
} from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { markAlarmReadFromPushData, navigateFromPushData } from '@/src/lib/push-open-navigation';

function notifeePayloadToData(
  data: { [key: string]: string | number | object } | undefined,
): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = v;
    else if (v == null) continue;
    else out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function fcmDataToRecord(data: { [key: string]: string | object } | undefined): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = v;
    else if (v == null) continue;
    else out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * FCM / Notifee 알림 탭 시 라우팅(채팅방 등).
 * - `messaging().getInitialNotification` / `onNotificationOpenedApp`
 * - `notifee.getInitialNotification` / `onForegroundEvent`(PRESS)
 */
export function FcmPushRoutingBootstrap() {
  const router = useRouter();
  const pathname = usePathname();
  const { markMeetingAlarmsReadByPushTap, markFriendRequestAlarmDismissed, markFriendAcceptedAlarmDismissed } =
    useInAppAlarms();
  const coldOpenHandledRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const openFromData = (data: Record<string, unknown> | undefined, source: string) => {
      ginitNotifyDbg('FcmPushRouting', 'openFromData', {
        source,
        action: typeof data?.action === 'string' ? data.action : undefined,
        meetingId: typeof data?.meetingId === 'string' ? data.meetingId : undefined,
        pathname,
      });
      navigateFromPushData(router, data, { replace: true, currentPathname: pathname });
      void markAlarmReadFromPushData(
        data,
        markMeetingAlarmsReadByPushTap,
        markFriendRequestAlarmDismissed,
        markFriendAcceptedAlarmDismissed,
      );
    };

    const m = getMessaging();
    const unsubOpened = onNotificationOpenedApp(m, (rm) => {
      openFromData(fcmDataToRecord(rm?.data), 'messaging_onOpened');
    });

    const unsubNotifeeFg = notifee.onForegroundEvent((ev) => {
      if (ev.type !== EventType.PRESS) return;
      const d = notifeePayloadToData(ev.detail.notification?.data);
      openFromData(d, 'notifee_foreground_press');
    });

    void (async () => {
      if (coldOpenHandledRef.current) return;
      const rm = await getInitialNotification(m);
      if (rm?.data && Object.keys(rm.data).length > 0) {
        coldOpenHandledRef.current = true;
        openFromData(fcmDataToRecord(rm.data), 'messaging_initial');
        return;
      }
      const initial = await notifee.getInitialNotification();
      if (initial?.notification) {
        coldOpenHandledRef.current = true;
        const d = notifeePayloadToData(initial.notification.data);
        openFromData(d, 'notifee_initial');
      }
    })();

    return () => {
      unsubOpened();
      unsubNotifeeFg();
    };
  }, [
    router,
    pathname,
    markMeetingAlarmsReadByPushTap,
    markFriendRequestAlarmDismissed,
    markFriendAcceptedAlarmDismissed,
  ]);

  return null;
}
