/**
 * 원격 시스템 알림(모임 채팅·DM·친구/팔로우·호스트 푸시 등)의 단일 진입점.
 *
 * - **FCM(Edge `fcm-push-send`) 우선** 후, 서버에서 실제 전달이 0건이면 **Expo Push로 폴백**합니다.
 * - 발신 단말 OS(`Platform.OS`)로 Expo를 생략하지 않습니다. (이전 버그: Android 발신 시 iOS 수신자가 Expo를 못 받음)
 * - 수신자가 Android이고 FCM+Expo 토큰이 모두 있으면 FCM 성공 시 Expo는 생략해 **이중 알림**을 줄입니다.
 */
import { doc, getDoc } from 'firebase/firestore';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { fcmPushSuccessCount, sendFcmPushToUsersWithResult, type FcmPushInvokeResult } from '@/src/lib/fcm-push-api';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { USER_EXPO_PUSH_TOKENS_COLLECTION } from '@/src/lib/user-expo-push-token';

export type RemotePushHubPayload = {
  toUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Expo 폴백(주로 단일 수신) 시에만 적용 — iOS 배너 보조줄 */
  expoSubtitle?: string;
  /** Expo 폴백 시에만 적용 */
  expoInterruptionLevel?: ExpoPushMessage['interruptionLevel'];
};

async function fetchExpoPushTokenForUser(userId: string): Promise<string | null> {
  const uid = normalizeParticipantId(userId.trim());
  if (!uid) return null;
  const snap = await getDoc(doc(getFirebaseFirestore(), USER_EXPO_PUSH_TOKENS_COLLECTION, uid));
  const t = snap.data()?.token;
  if (typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))) {
    return t;
  }
  return null;
}

async function fetchExpoPushTokensForUsers(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const db = getFirebaseFirestore();
  const tokens: string[] = [];
  await Promise.all(
    userIds.map(async (pid) => {
      const snap = await getDoc(doc(db, USER_EXPO_PUSH_TOKENS_COLLECTION, pid));
      const t = snap.data()?.token;
      if (typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))) {
        tokens.push(t);
      }
    }),
  );
  return tokens;
}

function shouldExpoFallbackAfterFcm(res: FcmPushInvokeResult): boolean {
  const reason = String(res.reason ?? '').trim();
  if (reason === 'all_recipients_muted') return false;
  return fcmPushSuccessCount(res) === 0;
}

/**
 * FCM → (필요 시) Expo. 실패는 삼키지 않고 상위에서 로그할 수 있게 throw할 수 있음 — 호출부에서 catch.
 */
export async function dispatchRemotePushToRecipients(params: RemotePushHubPayload): Promise<void> {
  const toUserIds = [...new Set((params.toUserIds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (toUserIds.length === 0) {
    ginitNotifyDbg('remote-push-hub', 'skip_empty_recipients', {});
    return;
  }
  const title = String(params.title ?? '').trim();
  const body = String(params.body ?? '').trim();
  if (!title || !body) {
    ginitNotifyDbg('remote-push-hub', 'skip_missing_title_body', { recipientCount: toUserIds.length });
    return;
  }
  const data = params.data;

  let fcmRes: FcmPushInvokeResult = {};
  try {
    fcmRes = await sendFcmPushToUsersWithResult({ toUserIds, title, body, data });
  } catch (e) {
    ginitNotifyDbg('remote-push-hub', 'fcm_invoke_threw', {
      message: e instanceof Error ? e.message : String(e),
    });
    fcmRes = {};
  }

  const fcmOk = fcmPushSuccessCount(fcmRes);
  const fcmReason = String(fcmRes.reason ?? '').trim();
  ginitNotifyDbg('remote-push-hub', 'fcm_result', {
    recipientCount: toUserIds.length,
    fcmSuccessApprox: fcmOk,
    reason: fcmReason || undefined,
    dataAction: typeof data?.action === 'string' ? data.action : undefined,
  });

  if (!shouldExpoFallbackAfterFcm(fcmRes)) return;

  ginitNotifyDbg('remote-push-hub', 'expo_fallback_start', {
    singleRecipient: toUserIds.length === 1,
    recipientCount: toUserIds.length,
  });

  if (toUserIds.length === 1) {
    const token = await fetchExpoPushTokenForUser(toUserIds[0]!);
    if (!token) {
      ginitNotifyDbg('remote-push-hub', 'expo_fallback_no_token', { userIdSuffix: String(toUserIds[0]).slice(-6) });
      return;
    }
    const msg: ExpoPushMessage = {
      to: token,
      title,
      body,
      subtitle: params.expoSubtitle?.trim() || undefined,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      interruptionLevel: params.expoInterruptionLevel ?? 'active',
      data,
    };
    await sendExpoPushMessages([msg]);
    ginitNotifyDbg('remote-push-hub', 'expo_fallback_sent', { count: 1 });
    return;
  }

  const tokens = await fetchExpoPushTokensForUsers(toUserIds);
  if (tokens.length === 0) {
    ginitNotifyDbg('remote-push-hub', 'expo_fallback_no_tokens_multi', { recipientCount: toUserIds.length });
    return;
  }
  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data,
  }));
  await sendExpoPushMessages(messages);
  ginitNotifyDbg('remote-push-hub', 'expo_fallback_sent', { count: messages.length });
}

export function dispatchRemotePushToRecipientsFireAndForget(params: RemotePushHubPayload): void {
  void dispatchRemotePushToRecipients(params).catch((err) => {
    ginitNotifyDbg('remote-push-hub', 'dispatch_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    if (__DEV__) {
      console.warn('[remote-push-hub]', err);
    }
  });
}
