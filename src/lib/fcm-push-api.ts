import { supabase } from '@/src/lib/supabase';

export type FcmPushSendParams = {
  toUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Android(FCM) 원격 푸시 전송(Edge Function).
 * - 수신자 앱이 완전 종료 상태여도 OS 트레이로 표시되도록 `notification` payload로 발송합니다(서버에서 처리).
 * - 현재 프로젝트는 Supabase Auth 세션이 없어도 호출하도록 구성될 수 있습니다(테스트 목적).
 */
export async function sendFcmPushToUsers(params: FcmPushSendParams): Promise<void> {
  const toUserIds = Array.isArray(params.toUserIds) ? params.toUserIds.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
  if (toUserIds.length === 0) return;
  const title = String(params.title ?? '').trim();
  const body = String(params.body ?? '').trim();
  if (!title || !body) return;

  const { error } = await supabase.functions.invoke('fcm-push-send', {
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
    const suffix = status ? ` (status ${status})` : '';
    throw new Error(`${error.message}${suffix}${bodyText ? `: ${bodyText.slice(0, 500)}` : ''}`);
  }
}

export function sendFcmPushToUsersFireAndForget(params: FcmPushSendParams): void {
  void sendFcmPushToUsers(params).catch((err) => {
    if (__DEV__) {
      console.warn('[fcm-push-send]', err);
    }
  });
}

