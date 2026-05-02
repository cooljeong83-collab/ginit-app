import { getMessaging, onMessage, onTokenRefresh, type FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, AppState, type AppStateStatus, Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { fcmDebugSetError, fcmDebugSetSaveOk, fcmDebugSetToken } from '@/src/lib/fcm-debug-state';
import { displayFcmRemoteMessageWithNotifeeAndroid, ensureGinitFcmNotifeeChannel } from '@/src/lib/fcm-notifee-display';
import { extractFirebaseLikeCode, hintForNativeFcmTokenError } from '@/src/lib/firebase-credential-hints';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import {
  ensureAndroidPostNotificationsForFcm,
  persistFcmTokenAndVerify,
  registerFcmDeviceAndGetToken,
} from '@/src/lib/fcm-token-supabase-sync';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import { isProfileFcmQuietHoursActive } from '@/src/lib/profile-settings-local';
import { NEW_MEETING_IN_FEED_REGION_FCM_ACTION } from '@/src/lib/meeting-area-notify-fcm';
import { isSocialChatNotifyEnabled } from '@/src/lib/social-chat-notify-preference';

function formatForegroundAlert(message: FirebaseMessagingTypes.RemoteMessage): { title: string; body: string } {
  const n = message.notification;
  const title = (n?.title ?? '').trim() || '새 알림';
  const body = (n?.body ?? '').trim() || (message.data?.body ? String(message.data.body) : '') || '새 소식이 도착했어요.';
  return { title, body };
}

/** 로그인 직후 등: 짧은 간격으로 최대 5회 getToken→저장 재시도 */
const FCM_REGISTER_RETRY_DELAYS_MS = [0, 1800, 3200, 6000, 10_000] as const;
/** 포그라운드 복귀 시 DB와 불일치 복구(너무 잦은 RPC 방지) */
const FCM_FOREGROUND_SYNC_MIN_INTERVAL_MS = 22_000;

/**
 * FCM 토큰 등록 + Foreground 메시지 핸들링.
 * Background/Quit은 `src/lib/fcm-background-handler.ts`에서 처리합니다.
 */
export function FcmMessagingBootstrap() {
  const { userId } = useUserSession();
  const lastSavedTokenRef = useRef<string>('');
  const userIdRef = useRef<string | null>(null);
  const lastForegroundSyncAtRef = useRef<number>(0);

  useEffect(() => {
    userIdRef.current = userId?.trim() ? userId.trim() : null;
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!userId?.trim()) return;

    const uid = userId.trim();
    let unsubToken: null | (() => void) = null;
    let unsubOnMessage: null | (() => void) = null;
    let unsubAppState: null | (() => void) = null;
    let alive = true;
    const m = getMessaging();

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    /**
     * @param dedupeMemory — false면 메모리상 동일 토큰이어도 DB에 다시 반영(서버에서 비운 뒤 복구 등)
     */
    const tryGetTokenAndPersist = async (dedupeMemory: boolean): Promise<'saved' | 'noop' | 'no_token' | 'error'> => {
      try {
        assertSupabasePublicReady();
      } catch (e) {
        fcmDebugSetError(e);
        ginitNotifyDbg('FcmMessaging', 'supabase_not_ready', { message: e instanceof Error ? e.message : String(e) });
        if (__DEV__) console.warn('[fcm] supabase not ready:', e);
        return 'error';
      }
      try {
        const t = await registerFcmDeviceAndGetToken(m);
        if (!alive) return 'noop';
        ginitNotifyDbg('FcmMessaging', 'getToken', {
          uidSuffix: uid.slice(-6),
          tokenLen: t.length,
          willPersist: Boolean(t && (!dedupeMemory || t !== lastSavedTokenRef.current)),
        });
        if (__DEV__) {
          console.log('[fcm] getToken result', { uid, tokenLen: t.length, dedupeMemory });
        }
        fcmDebugSetToken(t || null);
        if (!t) return 'no_token';
        if (dedupeMemory && t === lastSavedTokenRef.current) return 'noop';
        await persistFcmTokenAndVerify(uid, t);
        lastSavedTokenRef.current = t;
        fcmDebugSetSaveOk(true);
        return 'saved';
      } catch (e) {
        fcmDebugSetSaveOk(false);
        fcmDebugSetError(e);
        const msg = e instanceof Error ? e.message : String(e);
        const code = extractFirebaseLikeCode(e);
        ginitNotifyDbg('FcmMessaging', 'getToken_or_save_failed', {
          message: msg,
          code: code || undefined,
          reissueHint: hintForNativeFcmTokenError(msg, code),
        });
        if (__DEV__) {
          console.warn('[fcm] getToken/save failed:', e);
        }
        return 'error';
      }
    };

    void (async () => {
      // 권한은 "토큰 발급/표시" 안정성에 영향 (Android 13+)
      await ensureAndroidPostNotificationsForFcm();

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

      let tokenPersistOk = false;
      for (let attempt = 0; attempt < FCM_REGISTER_RETRY_DELAYS_MS.length; attempt += 1) {
        if (!alive) return;
        const delay = FCM_REGISTER_RETRY_DELAYS_MS[attempt]!;
        if (delay > 0) await sleep(delay);
        if (!alive) return;
        const dedupe = attempt === 0;
        const outcome = await tryGetTokenAndPersist(dedupe);
        if (outcome === 'saved') {
          tokenPersistOk = true;
          break;
        }
      }
      if (!tokenPersistOk) {
        ginitNotifyDbg('FcmMessaging', 'register_retries_exhausted', { uidSuffix: uid.slice(-6) });
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
          if (action === NEW_MEETING_IN_FEED_REGION_FCM_ACTION) {
            ginitNotifyDbg('FcmMessaging', 'on_message_new_meeting_feed_region', {
              meetingId: meetingId || undefined,
            });
          }
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
          if (await isProfileFcmQuietHoursActive()) {
            ginitNotifyDbg('FcmMessaging', 'foreground_skip_quiet_hours', { messageId: rm.messageId });
            return;
          }
          const { title, body } = formatForegroundAlert(rm);
          Alert.alert(title, body);
        });
      } catch {
        /* ignore */
      }

      const onAppStateChange = (next: AppStateStatus) => {
        if (next !== 'active' || !alive) return;
        const id = userIdRef.current;
        if (!id || id !== uid) return;
        const now = Date.now();
        if (now - lastForegroundSyncAtRef.current < FCM_FOREGROUND_SYNC_MIN_INTERVAL_MS) return;
        lastForegroundSyncAtRef.current = now;
        void (async () => {
          const outcome = await tryGetTokenAndPersist(false);
          if (outcome === 'saved' && __DEV__) {
            console.log('[fcm] foreground sync persisted', { uid: id });
          }
        })();
      };
      const appStateSub = AppState.addEventListener('change', onAppStateChange);
      unsubAppState = () => {
        try {
          appStateSub.remove();
        } catch {
          /* ignore */
        }
      };
    })();

    return () => {
      alive = false;
      lastSavedTokenRef.current = '';
      try {
        unsubAppState?.();
      } catch {
        /* ignore */
      }
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

