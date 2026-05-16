import type { StartPostgresRealtimeSubscriptionParams } from '@/src/lib/supabase-realtime-resilience';

/** `subscribeMeetingChatLiveTail` / `subscribeSocialChatLiveTail` 등 공통 콜백 */
export type ChatRealtimeSubscribeCallbacks = {
  onReconnecting?: () => void;
  onReconnected?: () => void;
  /** 재구독 포기 시에만(일시 transport 오류 아님) */
  onGiveUp?: (message: string) => void;
};

export function normalizeChatRealtimeSubscribeCallbacks(
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): ChatRealtimeSubscribeCallbacks {
  if (typeof callbacks === 'function') {
    return { onGiveUp: callbacks };
  }
  return callbacks ?? {};
}

export function postgresRealtimeHandlersFromChatCallbacks(
  callbacks: ChatRealtimeSubscribeCallbacks,
  userErrorMessage: string,
): Pick<
  StartPostgresRealtimeSubscriptionParams,
  'onReconnecting' | 'onReconnected' | 'onSubscribeGiveUp' | 'userErrorMessage'
> {
  return {
    userErrorMessage,
    onReconnecting: callbacks.onReconnecting,
    onReconnected: callbacks.onReconnected,
    onSubscribeGiveUp: callbacks.onGiveUp,
  };
}
