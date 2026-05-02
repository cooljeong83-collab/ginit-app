import { hintForFcmEdgeInvoke } from '@/src/lib/firebase-credential-hints';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { supabase } from '@/src/lib/supabase';

export type FcmPushSendParams = {
  toUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Edge `fcm-push-send` 응답(일부 필드는 버전에 따라 생략될 수 있음). */
export type FcmPushInvokeResult = {
  ok?: boolean;
  successCount?: number;
  sent?: number;
  attempted?: number;
  failureCount?: number;
  reason?: string;
};

function parseFcmInvokeData(data: unknown): FcmPushInvokeResult {
  if (!data || typeof data !== 'object') return {};
  return data as FcmPushInvokeResult;
}

/**
 * Android(FCM) 원격 푸시 전송(Edge Function) + 응답 파싱.
 * Expo 폴백 여부 판단은 `remote-push-hub`에서 사용합니다.
 */
export async function sendFcmPushToUsersWithResult(params: FcmPushSendParams): Promise<FcmPushInvokeResult> {
  const toUserIds = Array.isArray(params.toUserIds) ? params.toUserIds.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  if (toUserIds.length === 0) {
    ginitNotifyDbg('fcm-push-api', 'invoke_skip_no_recipients', {});
    return {};
  }
  const title = String(params.title ?? '').trim();
  const body = String(params.body ?? '').trim();
  if (!title || !body) {
    ginitNotifyDbg('fcm-push-api', 'invoke_skip_title_body', { recipientCount: toUserIds.length });
    return {};
  }

  ginitNotifyDbg('fcm-push-api', 'invoke_start', {
    recipientCount: toUserIds.length,
    dataAction: typeof params.data?.action === 'string' ? params.data.action : undefined,
  });

  const { data, error } = await supabase.functions.invoke('fcm-push-send', {
    body: {
      toUserIds,
      title,
      body,
      data: params.data ?? undefined,
    },
  });
  if (error) {
    const anyErr = error as any;
    const status = typeof anyErr?.context?.status === 'number' ? anyErr.context.status : undefined;
    const bodyText =
      typeof anyErr?.context?.body === 'string'
        ? anyErr.context.body
        : anyErr?.context?.body != null
          ? JSON.stringify(anyErr.context.body)
          : '';
    const snippet = bodyText.slice(0, 400);
    const reissueHint = hintForFcmEdgeInvoke(status, snippet);
    ginitNotifyDbg('fcm-push-api', 'invoke_http_error', {
      status,
      reissueHint,
      message: error.message,
      bodySnippet: snippet,
    });
    const suffix = status ? ` (status ${status})` : '';
    throw new Error(`${error.message}${suffix}${bodyText ? `: ${bodyText.slice(0, 500)}` : ''}`);
  }
  const dataType =
    data === null ? 'null' : data === undefined ? 'undefined' : Array.isArray(data) ? 'array' : typeof data;
  const invokeShape: Record<string, unknown> = { dataType };
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    invokeShape.objectKeyCount = Object.keys(data as object).length;
    invokeShape.objectKeysSample = Object.keys(data as object)
      .slice(0, 14)
      .join(',');
  } else if (typeof data === 'string') {
    invokeShape.stringHead = data.slice(0, 200);
  }
  ginitNotifyDbg('fcm-push-api', 'invoke_raw_shape', invokeShape);

  const parsed = parseFcmInvokeData(data);
  const computedOk = fcmPushSuccessCount(parsed);
  ginitNotifyDbg('fcm-push-api', 'invoke_ok', {
    ok: parsed.ok,
    successCount: parsed.successCount,
    sent: parsed.sent,
    reason: parsed.reason,
    fcmPushSuccessCountComputed: computedOk,
  });
  return parsed;
}

/**
 * Android(FCM) 원격 푸시 전송(Edge Function).
 * - 수신자 앱이 완전 종료 상태여도 OS 트레이로 표시되도록 `notification` payload로 발송합니다(서버에서 처리).
 * - 현재 프로젝트는 Supabase Auth 세션이 없어도 호출하도록 구성될 수 있습니다(테스트 목적).
 */
export async function sendFcmPushToUsers(params: FcmPushSendParams): Promise<void> {
  await sendFcmPushToUsersWithResult(params);
}

export function sendFcmPushToUsersFireAndForget(params: FcmPushSendParams): void {
  void sendFcmPushToUsers(params).catch((err) => {
    if (__DEV__) {
      console.warn('[fcm-push-send]', err);
    }
  });
}

/** `successCount` / `sent` 중 하나를 반환합니다. */
export function fcmPushSuccessCount(res: FcmPushInvokeResult): number {
  if (typeof res.successCount === 'number' && Number.isFinite(res.successCount)) return Math.max(0, res.successCount);
  if (typeof res.sent === 'number' && Number.isFinite(res.sent)) return Math.max(0, res.sent);
  return 0;
}
