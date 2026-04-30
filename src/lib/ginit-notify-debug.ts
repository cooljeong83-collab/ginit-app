/**
 * 채팅·인앱 알람·FCM/Expo 푸시 진단용 로그.
 * Metro / Xcode / `adb logcat` 에서 `[GinitNotify` 로 필터.
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
