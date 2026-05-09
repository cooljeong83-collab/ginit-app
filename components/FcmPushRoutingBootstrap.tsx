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
import { useUserSession } from '@/src/context/UserSessionContext';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import {
  explainShouldDeferPushOpenNavigation,
  setPendingPushOpenPayload,
  shouldDeferPushOpenNavigation,
} from '@/src/lib/pending-push-navigation';
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

/** FCM initial open 이 시스템 메타만 담아 Notifee 실제 탭 payload 를 가리는 경우 방지 */
function hasActionableFcmOpenData(data: Record<string, unknown> | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data).filter((k) => !k.startsWith('google.') && k !== 'collapse_key' && k !== 'from');
  if (keys.length === 0) return false;
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const url = typeof data.url === 'string' ? data.url.trim() : '';
  if (url.toLowerCase().startsWith('ginitapp://')) return true;
  if (action && (action.startsWith('in_app_') || action.includes('participant') || action === 'new_meeting_in_feed_region'))
    return true;
  if (meetingId && action) return true;
  return false;
}

/**
 * FCM / Notifee 알림 탭 시 라우팅(채팅방 등).
 * - `messaging().getInitialNotification` / `onNotificationOpenedApp`
 * - `notifee.getInitialNotification` / `onForegroundEvent`(PRESS)
 */
export function FcmPushRoutingBootstrap() {
  const router = useRouter();
  const pathname = usePathname();
  const { userId, isHydrated } = useUserSession();
  const { markMeetingAlarmsReadByPushTap, markFriendRequestAlarmDismissed, markFriendAcceptedAlarmDismissed } =
    useInAppAlarms();
  const coldOpenHandledRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const openFromData = (data: Record<string, unknown> | undefined, source: string) => {
      const deferReason = explainShouldDeferPushOpenNavigation({ isHydrated, userId, pathname });
      ginitNotifyDbg('FcmPushRouting', 'openFromData', {
        source,
        action: typeof data?.action === 'string' ? data.action : undefined,
        meetingId: typeof data?.meetingId === 'string' ? data.meetingId : undefined,
        pathname,
        deferReason: deferReason ?? 'none',
        dataKeyCount: data && typeof data === 'object' ? Object.keys(data).length : 0,
      });
      if (shouldDeferPushOpenNavigation({ isHydrated, userId, pathname })) {
        if (setPendingPushOpenPayload(data)) {
          ginitNotifyDbg('FcmPushRouting', 'defer_push_nav_pending_boot', { source, deferReason });
        } else {
          ginitNotifyDbg('FcmPushRouting', 'defer_push_nav_set_pending_failed_empty', { source, deferReason });
        }
        return;
      }
      navigateFromPushData(router, data, { replace: true, currentPathname: pathname });
      void markAlarmReadFromPushData(
        data,
        markMeetingAlarmsReadByPushTap,
        markFriendRequestAlarmDismissed,
        markFriendAcceptedAlarmDismissed,
      );
      ginitNotifyDbg('FcmPushRouting', 'navigate_immediate_done', { source });
    };

    const m = getMessaging();
    const unsubOpened = onNotificationOpenedApp(m, (rm) => {
      const raw = rm?.data;
      const keyCount = raw && typeof raw === 'object' ? Object.keys(raw).length : 0;
      ginitNotifyDbg('FcmPushRouting', 'messaging_onOpened_raw', {
        messageId: rm?.messageId,
        dataKeyCount: keyCount,
      });
      openFromData(fcmDataToRecord(raw), 'messaging_onOpened');
    });

    const unsubNotifeeFg = notifee.onForegroundEvent((ev) => {
      if (ev.type !== EventType.PRESS && ev.type !== EventType.ACTION_PRESS) {
        ginitNotifyDbg('FcmPushRouting', 'notifee_fg_skip_non_press', { type: ev.type });
        return;
      }
      const d = notifeePayloadToData(ev.detail.notification?.data);
      ginitNotifyDbg('FcmPushRouting', 'notifee_fg_press', {
        type: ev.type,
        dataKeyCount: d ? Object.keys(d).length : 0,
      });
      openFromData(d, 'notifee_foreground_press');
    });

    void (async () => {
      if (coldOpenHandledRef.current) return;
      const initial = await notifee.getInitialNotification();
      if (initial?.notification) {
        const d = notifeePayloadToData(initial.notification.data);
        const n = d ? Object.keys(d).length : 0;
        ginitNotifyDbg('FcmPushRouting', 'cold_notifee_getInitial', { hasNotification: true, dataKeyCount: n });
        if (d && Object.keys(d).length > 0) {
          coldOpenHandledRef.current = true;
          openFromData(d, 'notifee_initial');
          return;
        }
        ginitNotifyDbg('FcmPushRouting', 'cold_notifee_skip_empty_data', {});
      } else {
        ginitNotifyDbg('FcmPushRouting', 'cold_notifee_getInitial_null', {});
      }
      const rm = await getInitialNotification(m);
      const fcmRec = fcmDataToRecord(rm?.data);
      const rawKeys = rm?.data && typeof rm.data === 'object' ? Object.keys(rm.data).length : 0;
      ginitNotifyDbg('FcmPushRouting', 'cold_messaging_getInitial', {
        hasRemoteMessage: Boolean(rm),
        dataKeyCount: rawKeys,
        actionable: Boolean(fcmRec && hasActionableFcmOpenData(fcmRec)),
      });
      if (fcmRec && hasActionableFcmOpenData(fcmRec)) {
        coldOpenHandledRef.current = true;
        openFromData(fcmRec, 'messaging_initial');
      }
    })();

    return () => {
      unsubOpened();
      unsubNotifeeFg();
    };
  }, [
    router,
    pathname,
    userId,
    isHydrated,
    markMeetingAlarmsReadByPushTap,
    markFriendRequestAlarmDismissed,
    markFriendAcceptedAlarmDismissed,
  ]);

  return null;
}
