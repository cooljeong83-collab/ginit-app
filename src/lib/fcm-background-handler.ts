import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

import { displayFcmRemoteMessageWithNotifeeAndroid } from '@/src/lib/fcm-notifee-display';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

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
