import {
  getMessaging,
  registerDeviceForRemoteMessages,
  getToken,
  onMessage,
  onTokenRefresh,
  type FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { useEffect, useRef } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { fcmDebugSetError, fcmDebugSetSaveOk, fcmDebugSetToken } from '@/src/lib/fcm-debug-state';
import { displayFcmRemoteMessageWithNotifeeAndroid } from '@/src/lib/fcm-notifee-display';
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

async function ensureAndroidPostNotificationsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  // Android 13(API 33)+: 런타임 알림 권한 필요
  if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
  try {
    const res = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function formatForegroundAlert(message: FirebaseMessagingTypes.RemoteMessage): { title: string; body: string } {
  const n = message.notification;
  const title = (n?.title ?? '').trim() || '새 알림';
  const body = (n?.body ?? '').trim() || (message.data?.body ? String(message.data.body) : '') || '새 소식이 도착했어요.';
  return { title, body };
}

async function persistFcmTokenAndVerify(uid: string, token: string): Promise<void> {
  if (__DEV__) {
    console.log('[fcm] persist start', { uid, tokenLen: token.length });
  }
  await withTimeout(ensureUserProfile(uid), 12_000, '[fcm] ensureUserProfile');
  await withTimeout(updateUserProfile(uid, { fcmToken: token }), 12_000, '[fcm] updateUserProfile');
  const profile = await withTimeout(getUserProfile(uid), 8_000, '[fcm] getUserProfile');
  const saved = profile?.fcmToken?.trim() ?? '';
  if (saved !== token) {
    throw new Error('[fcm] token persisted check failed: profiles.fcm_token is empty or mismatched');
  }
  if (__DEV__) {
    console.log('[fcm] persist ok', { uid, savedLen: saved.length });
  }
}

/**
 * FCM 토큰 등록 + Foreground 메시지 핸들링.
 * Background/Quit은 `src/lib/fcm-background-handler.ts`에서 처리합니다.
 */
export function FcmMessagingBootstrap() {
  const { userId } = useUserSession();
  const lastSavedTokenRef = useRef<string>('');

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!userId?.trim()) return;

    const uid = userId.trim();
    let unsubToken: null | (() => void) = null;
    let unsubOnMessage: null | (() => void) = null;
    let alive = true;
    const m = getMessaging();

    void (async () => {
      // 권한은 "토큰 발급/표시" 안정성에 영향 (Android 13+)
      await ensureAndroidPostNotificationsPermission();

      // fcm_token 저장은 Supabase가 준비되어 있어야 합니다(미설정 시 조용히 실패하지 않도록 개발 로그).
      try {
        assertSupabasePublicReady();
      } catch (e) {
        fcmDebugSetError(e);
        if (__DEV__) {
          console.warn('[fcm] supabase not ready:', e);
        }
        // Supabase가 준비되지 않으면 fcm_token 저장이 불가능하므로 이후 단계도 의미가 없습니다.
        return;
      }

      try {
        // 일부 환경(iOS/특정 Android)에서 토큰 발급 전에 등록이 필요합니다.
        await registerDeviceForRemoteMessages(m);
        // Android 13에서 일부 환경은 채널/권한 전에 토큰이 늦게 생길 수 있어, 실패는 무시하고 다음 사이클에서 재시도합니다.
        const token = await getToken(m);
        if (!alive) return;
        const t = token?.trim() ?? '';
        if (__DEV__) {
          console.log('[fcm] getToken result', { uid, tokenLen: t.length });
        }
        fcmDebugSetToken(t || null);
        if (t && t !== lastSavedTokenRef.current) {
          // profiles 행이 없으면 update가 실패할 수 있어 먼저 보강하고, 저장 후 재조회로 검증합니다.
          await persistFcmTokenAndVerify(uid, t);
          lastSavedTokenRef.current = t;
          fcmDebugSetSaveOk(true);
        }
      } catch (e) {
        fcmDebugSetSaveOk(false);
        fcmDebugSetError(e);
        if (__DEV__) {
          console.warn('[fcm] getToken/save failed:', e);
        }
      }

      try {
        unsubToken = onTokenRefresh(m, (t) => {
          const next = String(t ?? '').trim();
          if (!next || next === lastSavedTokenRef.current) return;
          fcmDebugSetToken(next || null);
          void persistFcmTokenAndVerify(uid, next)
            .then(() => {
              lastSavedTokenRef.current = next;
              fcmDebugSetSaveOk(true);
            })
            .catch((e) => {
              fcmDebugSetSaveOk(false);
              fcmDebugSetError(e);
              if (__DEV__) console.warn('[fcm] tokenRefresh save failed:', e);
            });
        });
      } catch {
        /* ignore */
      }

      try {
        unsubOnMessage = onMessage(m, async (rm) => {
          if (Platform.OS === 'android') {
            const action = String(rm?.data?.action ?? '').trim();
            const meetingId = String(rm?.data?.meetingId ?? '').trim();
            if ((action === 'in_app_chat' || action === 'in_app_social_dm') && meetingId) {
              const cur = getCurrentChatRoomId();
              if (cur && cur === meetingId) return;
            }
            await displayFcmRemoteMessageWithNotifeeAndroid(rm);
            return;
          }
          const { title, body } = formatForegroundAlert(rm);
          Alert.alert(title, body);
        });
      } catch {
        /* ignore */
      }
    })();

    return () => {
      alive = false;
      try {
        unsubToken?.();
      } catch {
        /* ignore */
      }
      try {
        unsubOnMessage?.();
      } catch {
        /* ignore */
      }
    };
  }, [userId]);

  return null;
}

