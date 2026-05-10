/**
 * 지닛 벨 등 커스텀 알림음이 시스템 기본으로 떨어질 때 원인 추적용.
 * `__DEV__` 또는 `EXPO_PUBLIC_GINIT_NOTIFY_DEBUG=1` 일 때만 동작.
 * `adb logcat` / Xcode 에서 `[GinitNotify:notify-sound-diag]` 필터.
 */
import notifee from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ginitNotifyDbg, isGinitNotifyDebugEnabled } from '@/src/lib/ginit-notify-debug';
import {
  getGinitFcmDisplayNotifeeChannelId,
  getGinitInAppAndroidChannelId,
  loadProfileNotificationSoundId,
  notifeeAndroidRawBaseName,
  PROFILE_NOTIFICATION_SOUND_OPTIONS,
} from '@/src/lib/profile-notification-sound-preference';

/** `fcm-notifee-display` 의 GINIT_FCM_NOTIFEE_CHANNEL 과 동일 */
const LEGACY_FCM_NOTIFEE_CHANNEL = 'ginit_fcm';

let lastFcmNotifeeDiagAt = 0;
let lastExpoInAppDiagAt = 0;
const THROTTLE_MS = 20000;

function compactNotifeeChannel(ch: Awaited<ReturnType<typeof notifee.getChannel>>): Record<string, unknown> | null {
  if (!ch) return null;
  const o = ch as unknown as Record<string, unknown>;
  return {
    id: o.id,
    sound: o.sound,
    soundURI: o.soundURI,
  };
}

/** `ensureGinitFcmNotifeeChannel` 직후 — Notifee `getChannel` 로 OS에 등록된 소리 확인 */
export async function diagLogAfterEnsureFcmNotifeeChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!isGinitNotifyDebugEnabled()) return;
  const now = Date.now();
  if (now - lastFcmNotifeeDiagAt < THROTTLE_MS) return;
  lastFcmNotifeeDiagAt = now;
  try {
    const pref = await loadProfileNotificationSoundId();
    const rawHint = notifeeAndroidRawBaseName(pref);
    const displayId = await getGinitFcmDisplayNotifeeChannelId();
    const legacy = await notifee.getChannel(LEGACY_FCM_NOTIFEE_CHANNEL);
    const display = await notifee.getChannel(displayId);
    ginitNotifyDbg('notify-sound-diag', 'notifee_after_fcm_ensure', {
      pref,
      notifeeCreateSoundParam: rawHint ?? 'default',
      displayChannelId: displayId,
      legacyChannel: compactNotifeeChannel(legacy),
      displayChannel: compactNotifeeChannel(display),
    });
  } catch (e) {
    ginitNotifyDbg('notify-sound-diag', 'notifee_after_fcm_ensure_err', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** `ensureGinitInAppAndroidChannel` 직후 — Expo 채널에 반영된 `sound` 종류 확인 */
export async function diagLogAfterEnsureExpoInAppChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!isGinitNotifyDebugEnabled()) return;
  const now = Date.now();
  if (now - lastExpoInAppDiagAt < THROTTLE_MS) return;
  lastExpoInAppDiagAt = now;
  try {
    const pref = await loadProfileNotificationSoundId();
    const channelId = await getGinitInAppAndroidChannelId();
    const opt = PROFILE_NOTIFICATION_SOUND_OPTIONS.find((o) => o.id === pref);
    const setParamSound = pref === 'default' ? 'default' : opt?.expoFilename ?? 'default';
    const ch = await Notifications.getNotificationChannelAsync(channelId);
    ginitNotifyDbg('notify-sound-diag', 'expo_after_in_app_ensure', {
      pref,
      channelId,
      setParamSound,
      resolvedSound: ch?.sound ?? null,
      importance: ch?.importance,
    });
  } catch (e) {
    ginitNotifyDbg('notify-sound-diag', 'expo_after_in_app_ensure_err', {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
