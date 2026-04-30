import {
  getMessaging,
  registerDeviceForRemoteMessages,
  getToken,
  onMessage,
  onTokenRefresh,
  type FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, PermissionsAndroid, Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { fcmDebugSetError, fcmDebugSetSaveOk, fcmDebugSetToken } from '@/src/lib/fcm-debug-state';
import { displayFcmRemoteMessageWithNotifeeAndroid, ensureGinitFcmNotifeeChannel } from '@/src/lib/fcm-notifee-display';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import { isSocialChatNotifyEnabled } from '@/src/lib/social-chat-notify-preference';
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
  ginitNotifyDbg('FcmMessaging', 'persist_start', { uidSuffix: uid.slice(-6), tokenLen: token.length });
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
  ginitNotifyDbg('FcmMessaging', 'persist_ok', { uidSuffix: uid.slice(-6), savedLen: saved.length });
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

      if (Platform.OS === 'android') {
        try {
          /**
           * 서버 FCM(`fcm-push-send`)이 사용하는 채널과 동일하게 맞춥니다.
           * `PushNotificationBootstrap`은 알림 권한 granted 이후에만 `default` 채널을 만들어,
           * 권한 지연·거절 직후에는 OS 트레이 알림이 빠질 수 있어 여기서 선(先) 생성합니다.
           */
          await ensureGinitFcmNotifeeChannel();
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 220],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          });
        } catch {
          /* 채널 생성 실패는 이후 표시 경로에서 재시도 */
        }
      }

      // fcm_token 저장은 Supabase가 준비되어 있어야 합니다(미설정 시 조용히 실패하지 않도록 개발 로그).
      try {
        assertSupabasePublicReady();
      } catch (e) {
        fcmDebugSetError(e);
        ginitNotifyDbg('FcmMessaging', 'supabase_not_ready', { message: e instanceof Error ? e.message : String(e) });
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
        ginitNotifyDbg('FcmMessaging', 'getToken', { uidSuffix: uid.slice(-6), tokenLen: t.length, willPersist: Boolean(t && t !== lastSavedTokenRef.current) });
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
        ginitNotifyDbg('FcmMessaging', 'getToken_or_save_failed', { message: e instanceof Error ? e.message : String(e) });
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
              ginitNotifyDbg('FcmMessaging', 'token_refresh_save_failed', { message: e instanceof Error ? e.message : String(e) });
              if (__DEV__) console.warn('[fcm] tokenRefresh save failed:', e);
            });
        });
      } catch {
        /* ignore */
      }

      try {
        unsubOnMessage = onMessage(m, async (rm) => {
          const action = String(rm?.data?.action ?? '').trim();
          const meetingId = String(rm?.data?.meetingId ?? '').trim();
          ginitNotifyDbg('FcmMessaging', 'on_message', {
            messageId: rm.messageId,
            action: action || undefined,
            meetingId: meetingId || undefined,
            hasNotification: Boolean(rm.notification),
            platform: Platform.OS,
          });
          if (action === 'in_app_chat' && meetingId) {
            const notifyOn = await isMeetingChatNotifyEnabled(meetingId);
            if (!notifyOn) {
              ginitNotifyDbg('FcmMessaging', 'foreground_skip_meeting_notify_off', { meetingId });
              return;
            }
          }
          if (action === 'in_app_social_dm' && meetingId) {
            const notifyOn = await isSocialChatNotifyEnabled(meetingId);
            if (!notifyOn) {
              ginitNotifyDbg('FcmMessaging', 'foreground_skip_social_notify_off', { meetingId });
              return;
            }
          }
          if (Platform.OS === 'android') {
            if ((action === 'in_app_chat' || action === 'in_app_social_dm') && meetingId) {
              const cur = getCurrentChatRoomId();
              if (cur && cur === meetingId) {
                ginitNotifyDbg('FcmMessaging', 'foreground_skip_same_room', { meetingId });
                return;
              }
            }
            await displayFcmRemoteMessageWithNotifeeAndroid(rm);
            ginitNotifyDbg('FcmMessaging', 'foreground_notifee_displayed', { messageId: rm.messageId });
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

