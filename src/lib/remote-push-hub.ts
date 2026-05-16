/**
 * 원격 시스템 알림(모임 채팅·DM·친구/팔로우·호스트 푸시 등)의 단일 진입점.
 *
 * - **FCM(Edge `fcm-push-send`) 우선** 후, 서버에서 실제 전달이 0건이면 **Expo Push로 폴백**합니다.
 * - 발신 단말 OS(`Platform.OS`)로 Expo를 생략하지 않습니다. (이전 버그: Android 발신 시 iOS 수신자가 Expo를 못 받음)
 * - 수신자가 Android이고 FCM+Expo 토큰이 모두 있으면 FCM 성공 시 Expo는 생략해 **이중 알림**을 줄입니다.
 */
import { hintForFcmEdgeInvoke } from '@/src/lib/firebase-credential-hints';
import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { fcmPushSuccessCount, sendFcmPushToUsersWithResult, type FcmPushInvokeResult } from '@/src/lib/fcm-push-api';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

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

/** Firestore `userExpoPushTokens` 제거 — Expo 폴백 토큰은 서버/프로필 경로로 이전 필요 시 여기서 조회하세요. */
async function fetchExpoPushTokenForUser(_userId: string): Promise<string | null> {
  return null;
}

async function fetchExpoPushTokensForUsers(_userIds: string[]): Promise<string[]> {
  return [];
}
function shouldExpoFallbackAfterFcm(res: FcmPushInvokeResult): boolean {
  const reason = String(res.reason ?? '').trim();
  if (reason === 'all_recipients_muted') return false;
  return fcmPushSuccessCount(res) === 0;
}

/**
 * FCM → (필요 시) Expo. 근사 전달 건수(FCM 성공 건수 또는 Expo로 실제 전송한 메시지 수)를 반환합니다.
 * 수신자/제목 없음 등으로 스킵한 경우 0.
 */
export async function dispatchRemotePushToRecipientsWithApproxDelivered(
  params: RemotePushHubPayload,
): Promise<number> {
  const toUserIds = [...new Set((params.toUserIds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (toUserIds.length === 0) {
    ginitNotifyDbg('remote-push-hub', 'skip_empty_recipients', {});
    return 0;
  }
  const title = String(params.title ?? '').trim();
  const body = String(params.body ?? '').trim();
  if (!title || !body) {
    ginitNotifyDbg('remote-push-hub', 'skip_missing_title_body', { recipientCount: toUserIds.length });
    return 0;
  }
  const data = params.data;

  let fcmRes: FcmPushInvokeResult = {};
  try {
    fcmRes = await sendFcmPushToUsersWithResult({ toUserIds, title, body, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const statusMatch = msg.match(/\(status (\d+)\)/);
    const status = statusMatch ? Number(statusMatch[1]) : undefined;
    const colon = msg.indexOf(': ');
    const bodyLike = colon >= 0 ? msg.slice(colon + 2) : msg;
    ginitNotifyDbg('remote-push-hub', 'fcm_invoke_threw', {
      message: msg.slice(0, 400),
      status: status ?? undefined,
      reissueHint: hintForFcmEdgeInvoke(status, bodyLike.slice(0, 500)),
    });
    fcmRes = {};
  }

  const fcmOk = fcmPushSuccessCount(fcmRes);
  const fcmReason = String(fcmRes.reason ?? '').trim();
  const willExpoFallback = shouldExpoFallbackAfterFcm(fcmRes);
  ginitNotifyDbg('remote-push-hub', 'fcm_result', {
    recipientCount: toUserIds.length,
    fcmSuccessApprox: fcmOk,
    reason: fcmReason || undefined,
    dataAction: typeof data?.action === 'string' ? data.action : undefined,
    willExpoFallback,
  });

  if (!willExpoFallback) return fcmOk;

  ginitNotifyDbg('remote-push-hub', 'expo_fallback_start', {
    singleRecipient: toUserIds.length === 1,
    recipientCount: toUserIds.length,
  });

  if (toUserIds.length === 1) {
    const token = await fetchExpoPushTokenForUser(toUserIds[0]!);
    if (!token) {
      ginitNotifyDbg('remote-push-hub', 'expo_fallback_no_token', { userIdSuffix: String(toUserIds[0]).slice(-6) });
      return fcmOk;
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
    return Math.max(fcmOk, 1);
  }

  const tokens = await fetchExpoPushTokensForUsers(toUserIds);
  if (tokens.length === 0) {
    ginitNotifyDbg('remote-push-hub', 'expo_fallback_no_tokens_multi', { recipientCount: toUserIds.length });
    return fcmOk;
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
  return Math.max(fcmOk, messages.length);
}

/**
 * FCM → (필요 시) Expo. 실패는 삼키지 않고 상위에서 로그할 수 있게 throw할 수 있음 — 호출부에서 catch.
 */
export async function dispatchRemotePushToRecipients(params: RemotePushHubPayload): Promise<void> {
  await dispatchRemotePushToRecipientsWithApproxDelivered(params);
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
