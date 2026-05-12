import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import { Platform } from 'react-native';

import { handleChatPushNotificationAction } from '@/src/lib/chat-push-notification-actions';
import { displayFcmRemoteMessageWithNotifeeAndroid } from '@/src/lib/fcm-notifee-display';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { setPendingPushOpenPayload } from '@/src/lib/pending-push-navigation';

/**
 * FCM Background/Quit 핸들러 (Android).
 *
 * - 이 파일은 모듈 평가 시점에 등록되어야 합니다. (`app/_layout.tsx`에서 최상단 import)
 * - `notification` payload만 있는 메시지는 백그라운드에서 보통 이 핸들러가 아니라 트레이로 직접 전달됩니다.
 * - **data-only**는 OS가 자동 표시하지 않으므로 Notifee로 시스템 알림을 띄웁니다.
 */
const m = getMessaging();
setBackgroundMessageHandler(m, async (remoteMessage) => {
  if (Platform.OS !== 'android') return;
  try {
    const d = remoteMessage?.data;
    const action = d && typeof d.action === 'string' ? d.action : '';
    const meetingId = d && typeof d.meetingId === 'string' ? d.meetingId : '';
    ginitNotifyDbg('fcm-background', 'message', {
      hasNotification: Boolean(remoteMessage?.notification),
      messageId: remoteMessage?.messageId,
      action: action || undefined,
      meetingId: meetingId || undefined,
    });
    // notification payload는 OS 트레이가 이미 처리하므로 data-only에서만 수동 표시합니다.
    if (remoteMessage?.notification) return;
    await displayFcmRemoteMessageWithNotifeeAndroid(remoteMessage);
    ginitNotifyDbg('fcm-background', 'notifee_display_done', { messageId: remoteMessage?.messageId });
  } catch (e) {
    ginitNotifyDbg('fcm-background', 'handler_error', { message: e instanceof Error ? e.message : String(e) });
    /* ignore */
  }
});

notifee.onBackgroundEvent(async (event) => {
  if (Platform.OS !== 'android') return;
  try {
    if (event.type !== EventType.PRESS && event.type !== EventType.ACTION_PRESS) {
      ginitNotifyDbg('fcm-background', 'notifee_bg_skip_type', { type: event.type });
      return;
    }
    const raw = event.detail.notification?.data;
    if (!raw || typeof raw !== 'object') {
      ginitNotifyDbg('fcm-background', 'notifee_bg_press_no_data_object', {});
      return;
    }
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') data[k] = v;
      else if (v == null) continue;
      else data[k] = String(v);
    }
    const kc = Object.keys(data).length;
    if (kc === 0) {
      ginitNotifyDbg('fcm-background', 'notifee_bg_press_empty_keys', {});
      return;
    }
    if (event.type === EventType.ACTION_PRESS) {
      const actionId = (event.detail.pressAction as { id?: string } | undefined)?.id;
      const input = (event.detail as { input?: string }).input;
      if (await handleChatPushNotificationAction(actionId, data, input)) {
        ginitNotifyDbg('fcm-background', 'notifee_bg_action_handled', { actionId });
        return;
      }
    }
    if (setPendingPushOpenPayload(data)) {
      ginitNotifyDbg('fcm-background', 'notifee_bg_press_deferred', {
        action: typeof data.action === 'string' ? data.action : undefined,
        keyCount: kc,
      });
    } else {
      ginitNotifyDbg('fcm-background', 'notifee_bg_press_set_pending_failed', { keyCount: kc });
    }
  } catch {
    /* ignore */
  }
});
