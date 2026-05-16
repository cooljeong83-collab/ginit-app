import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/src/lib/supabase';

/** WebSocket 단계 재연결 간격(RealtimeClient `reconnectAfterMs`). */
export function supabaseRealtimeReconnectAfterMs(tries: number): number {
  return Math.min(60_000, 800 * 2 ** Math.min(tries, 10));
}

/** 채널 단위 재구독 백오프(`CHANNEL_ERROR` 등으로 채널을 다시 만들 때). */
export function postgresChangesResubscribeDelayMs(failureIndex: number): number {
  return Math.min(60_000, 600 * 2 ** Math.min(Math.max(0, failureIndex), 12));
}

function realtimeChannelSuffix(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } };
  return typeof c.crypto?.randomUUID === 'function'
    ? c.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Realtime private 채널·RLS 토픽용 `auth.users.id` (이메일 app_user_id와 분리) */
export async function getSupabaseAuthUserIdForRealtimeTopic(): Promise<string> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id?.trim() ?? '';
  } catch {
    return '';
  }
}

/** private Broadcast / postgres_changes 구독 전 JWT를 Realtime 소켓에 반영 */
export async function ensureSupabaseRealtimeAuthFromSession(maxWaitMs = 5000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const t = session?.access_token?.trim();
    if (t) {
      try {
        await supabase.realtime.setAuth(t);
      } catch {
        /* noop */
      }
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 120));
  }
  return false;
}

/** fetch/RPC/WebSocket이 잠깐 끊길 때 흔한 메시지(오프라인 동기화·Realtime 공통) */
export function isTransientNetworkErrorMessage(message: string | null | undefined): boolean {
  const msg = String(message ?? '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('transport failure') ||
    msg.includes('websocket') ||
    msg.includes('failed to fetch') ||
    msg.includes('connection closed') ||
    msg.includes('disconnected') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted')
  );
}

/** 백그라운드·네트워크 전환 등으로 WebSocket이 잠깐 끊길 때 흔한 메시지 */
export function isRealtimeTransportFailure(err?: Error): boolean {
  return isTransientNetworkErrorMessage(err?.message);
}

export function formatRealtimeSubscribeDetail(status: string, err?: Error): string {
  const parts = [`status=${status}`];
  if (err?.name) parts.push(`err.name=${err.name}`);
  if (err?.message) parts.push(`err.message=${err.message}`);
  const anyErr = err as { code?: unknown; details?: unknown; hint?: unknown } | undefined;
  if (anyErr?.code != null) parts.push(`err.code=${String(anyErr.code)}`);
  if (anyErr?.details != null) parts.push(`err.details=${String(anyErr.details)}`);
  if (anyErr?.hint != null) parts.push(`err.hint=${String(anyErr.hint)}`);
  return parts.join(' | ');
}

export type StartPostgresRealtimeSubscriptionParams = {
  /** `meeting-chat-live` 등 고정 접두사(고유 키·접미사는 자동). */
  channelBaseName: string;
  uniqueKey: string;
  configure: (channel: RealtimeChannel) => void;
  shouldStop: () => boolean;
  logLabel: string;
  /** 재구독을 모두 포기한 뒤 1회(일시 transport 오류에는 호출하지 않음). */
  onSubscribeGiveUp?: (userMessage: string) => void;
  /** @deprecated `onSubscribeGiveUp` 사용 */
  onFirstSubscribeFailure?: (userMessage: string) => void;
  /** `CHANNEL_ERROR` / `TIMED_OUT` 직후 — RPC 폴백 등(재시도 예정). */
  onTransientFailure?: () => void;
  /** transport 등 일시 끊김 — UI「재연결 시도 중」 */
  onReconnecting?: () => void;
  /** `SUBSCRIBED` 복구 — UI 배너 해제 */
  onReconnected?: () => void;
  userErrorMessage: string;
  maxAttempts?: number;
};

/**
 * `postgres_changes` 채널을 구독하고, `CHANNEL_ERROR` / `TIMED_OUT` 시 채널을 제거한 뒤
 * 지수 백오프로 재구독합니다.
 */
export function startPostgresRealtimeSubscription(params: StartPostgresRealtimeSubscriptionParams): () => void {
  let subscribeFailures = 0;
  let channel: RealtimeChannel | null = null;
  let lastTopic: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const maxAttempts = params.maxAttempts ?? 40;
  const notifyGiveUp = (message: string) => {
    (params.onSubscribeGiveUp ?? params.onFirstSubscribeFailure)?.(message);
  };

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const stop = () => {
    clearRetry();
    if (__DEV__) {
      if (channel) {
        console.log(`[${params.logLabel}] realtime: stop → removeChannel topic=${lastTopic ?? '?'}`);
      } else {
        console.log(`[${params.logLabel}] realtime: stop (no active channel)`);
      }
    }
    if (channel) void supabase.removeChannel(channel);
    channel = null;
    lastTopic = null;
  };

  const scheduleRetry = () => {
    clearRetry();
    if (params.shouldStop()) return;
    if (subscribeFailures >= maxAttempts) {
      console.warn(`[${params.logLabel}] realtime: max subscribe attempts (${maxAttempts}) reached, stopping retries`);
      notifyGiveUp(params.userErrorMessage);
      return;
    }
    const delay = postgresChangesResubscribeDelayMs(subscribeFailures - 1);
    if (__DEV__) {
      console.log(
        `[${params.logLabel}] realtime: resubscribe in ${delay}ms (failure #${subscribeFailures}, max ${maxAttempts})`,
      );
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (params.shouldStop()) return;
    if (channel) {
      if (__DEV__) {
        console.log(`[${params.logLabel}] realtime: reconnect → removeChannel topic=${lastTopic ?? '?'}`);
      }
      void supabase.removeChannel(channel);
    }
    const topic = `${params.channelBaseName}:${params.uniqueKey}:${realtimeChannelSuffix()}`;
    const ch = supabase.channel(topic);
    channel = ch;
    lastTopic = topic;
    if (__DEV__) console.log(`[${params.logLabel}] realtime: channel created topic=${topic}`);
    params.configure(ch);
    ch.subscribe((status, err) => {
      const detail = formatRealtimeSubscribeDetail(status, err);
      if (status === 'SUBSCRIBED') {
        if (__DEV__) console.log(`[${params.logLabel}] realtime: ${detail} topic=${topic}`);
        subscribeFailures = 0;
        try {
          params.onReconnected?.();
        } catch {
          /* noop */
        }
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const transport = isRealtimeTransportFailure(err);
        if (__DEV__) {
          const retryHint = `(retry #${subscribeFailures + 1}/${maxAttempts})`;
          if (transport) {
            console.log(
              `[${params.logLabel}] realtime: ${detail} — transient transport, will resubscribe ${retryHint} topic=${topic}`,
            );
          } else {
            console.warn(`[${params.logLabel}] realtime: ${detail} ${retryHint} topic=${topic}`);
          }
        } else if (!transport) {
          console.warn(`[${params.logLabel}] realtime: ${detail} topic=${topic}`);
        }
        try {
          params.onTransientFailure?.();
          params.onReconnecting?.();
        } catch {
          /* noop */
        }
        if (__DEV__) console.log(`[${params.logLabel}] realtime: error path → removeChannel topic=${topic}`);
        void supabase.removeChannel(ch);
        if (channel === ch) {
          channel = null;
          lastTopic = null;
        }
        subscribeFailures += 1;
        scheduleRetry();
        return;
      }
      if (__DEV__) {
        console.log(`[${params.logLabel}] realtime: ${detail} topic=${topic}`);
      }
    });
  };

  connect();
  return stop;
}
