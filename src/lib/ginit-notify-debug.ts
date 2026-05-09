/**
 * 채팅·인앱 알람·FCM/Expo 푸시 진단용 로그.
 * Metro / Xcode / `adb logcat` 에서 `[GinitNotify` 로 필터.
 *
 * 알림 탭 → 화면 이동(FCM/Notifee) 추적 시 권장 스코프:
 * - `FcmPushRouting` — `onNotificationOpenedApp`, Notifee 포그라운드 탭, 콜드 `getInitial*`
 * - `push-open-nav` — `navigateFromPushData` 분기(채팅/모임/url 등)
 * - `pending-push-nav` — 부트 보류 payload set/consume
 * - `PendingPushFlush` — 스플래시 이탈 후 보류 소비·재시도
 * - `fcm-background` — 백그라운드 Notifee 탭 → pending 적재
 * - `ExpoPushRouting` — Expo 알림 탭 경로
 *
 * - 개발 빌드(`__DEV__`): 항상 켜짐
 * - 릴리스에서 잠깐 켜기: `.env` 에 `EXPO_PUBLIC_GINIT_NOTIFY_DEBUG=1` 후 재빌드
 */
function isGinitNotifyDebugEnabled(): boolean {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  } catch {
    /* noop */
  }
  try {
    return process.env.EXPO_PUBLIC_GINIT_NOTIFY_DEBUG === '1';
  } catch {
    return false;
  }
}

export function ginitNotifyDbg(scope: string, event: string, extra?: Record<string, unknown>): void {
  if (!isGinitNotifyDebugEnabled()) return;
  const tag = `[GinitNotify:${scope}]`;
  if (extra != null && Object.keys(extra).length > 0) {
    console.log(tag, event, extra);
  } else {
    console.log(tag, event);
  }
}
