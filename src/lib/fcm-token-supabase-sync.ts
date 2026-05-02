import { getMessaging, getToken, registerDeviceForRemoteMessages } from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';

import { fcmDebugSetError, fcmDebugSetSaveOk, fcmDebugSetToken } from '@/src/lib/fcm-debug-state';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import { ensureUserProfile, getUserProfile, updateUserProfile } from '@/src/lib/user-profile';

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

let postNotificationsPermissionInFlight: Promise<boolean> | null = null;

/**
 * Android 13+ POST_NOTIFICATIONS.
 * `setUserId` 직후 `syncFcmTokenFromDeviceToProfile`와 `FcmMessagingBootstrap`이 같은 틱에
 * 각각 `PermissionsAndroid.request`를 호출하면, 한쪽 Promise가 끝나지 않는 기기가 있어
 * 요청을 단일 비행으로 묶습니다.
 */
export async function ensureAndroidPostNotificationsForFcm(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
  if (postNotificationsPermissionInFlight) {
    return postNotificationsPermissionInFlight;
  }
  postNotificationsPermissionInFlight = (async () => {
    try {
      const res = await withTimeout(
        PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS'),
        28_000,
        '[fcm] POST_NOTIFICATIONS',
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    } finally {
      postNotificationsPermissionInFlight = null;
    }
  })();
  return postNotificationsPermissionInFlight;
}

/** `registerDeviceForRemoteMessages` / `getToken` 은 일부 기기·상황에서 응답이 없을 수 있어 상한을 둡니다. */
export async function registerFcmDeviceAndGetToken(m: ReturnType<typeof getMessaging>): Promise<string> {
  await withTimeout(registerDeviceForRemoteMessages(m), 22_000, '[fcm] registerDeviceForRemoteMessages');
  const raw = await withTimeout(getToken(m), 22_000, '[fcm] getToken');
  return (typeof raw === 'string' ? raw : '').trim();
}

/** FcmMessagingBootstrap·로그인 직후 공통: Supabase profiles.fcm_token 저장 + 재조회 검증 */
export async function persistFcmTokenAndVerify(uid: string, token: string): Promise<void> {
  ginitNotifyDbg('FcmMessaging', 'persist_start', { uidSuffix: uid.slice(-6), tokenLen: token.length });
  if (__DEV__) {
    console.log('[fcm] persist start', { uid, tokenLen: token.length });
  }
  await withTimeout(ensureUserProfile(uid), 12_000, '[fcm] ensureUserProfile');
  const fcmPlatform =
    Platform.OS === 'ios' ? ('ios' as const) : Platform.OS === 'android' ? ('android' as const) : undefined;
  await withTimeout(
    updateUserProfile(uid, {
      fcmToken: token,
      ...(fcmPlatform ? { fcmPlatform } : {}),
    }),
    12_000,
    '[fcm] updateUserProfile',
  );
  const profile = await withTimeout(getUserProfile(uid), 8_000, '[fcm] getUserProfile');
  const saved = profile?.fcmToken?.trim() ?? '';
  if (saved !== token) {
    throw new Error('[fcm] token persisted check failed: profiles.fcm_token is empty or mismatched');
  }
  ginitNotifyDbg('FcmMessaging', 'persist_ok', { uidSuffix: uid.slice(-6), savedLen: saved.length });
  if (__DEV__) {
    console.log('[fcm] persist ok', { uid, savedLen: saved.length });
  }
}

/**
 * 로그인 직후: `setUserId` 직후 한 번 호출해 부트스트랩 effect보다 먼저 DB에 FCM 토큰을 올립니다.
 * (재설치 직후 타이밍·다른 RPC와의 경합 완화)
 */
export async function syncFcmTokenFromDeviceToProfile(appUserId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const uid = appUserId.trim();
  if (!uid) return;
  try {
    assertSupabasePublicReady();
  } catch {
    return;
  }
  await ensureAndroidPostNotificationsForFcm();
  try {
    const m = getMessaging();
    const t = await registerFcmDeviceAndGetToken(m);
    fcmDebugSetToken(t || null);
    if (!t) {
      ginitNotifyDbg('FcmMessaging', 'login_sync_no_token', { uidSuffix: uid.slice(-6) });
      return;
    }
    await persistFcmTokenAndVerify(uid, t);
    fcmDebugSetSaveOk(true);
  } catch (e) {
    fcmDebugSetSaveOk(false);
    fcmDebugSetError(e);
    ginitNotifyDbg('FcmMessaging', 'login_sync_failed', { message: e instanceof Error ? e.message : String(e) });
    if (__DEV__) {
      console.warn('[fcm] syncFcmTokenFromDeviceToProfile failed:', e);
    }
  }
}
