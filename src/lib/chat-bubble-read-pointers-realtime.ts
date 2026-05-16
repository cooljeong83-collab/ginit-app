import type { RealtimeChannel } from '@supabase/supabase-js';

import type { ChatReadPointerRealtimePayload } from '@/src/lib/chat-read-pointer-realtime-local';
import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import {
  normalizeChatRealtimeSubscribeCallbacks,
  postgresRealtimeHandlersFromChatCallbacks,
  type ChatRealtimeSubscribeCallbacks,
} from '@/src/lib/chat-realtime-subscribe-callbacks';
import { startPostgresRealtimeSubscription } from '@/src/lib/supabase-realtime-resilience';

/** `chat_messages` 실시간과 동일: 따옴표 없이 `column=eq.value` 형식만 사용 */
export function chatReadPointersPostgresFilter(roomKind: ChatRoomKindDelta, roomId: string): string {
  const kind = roomKind === 'social_dm' ? 'social_dm' : 'meeting';
  const rid = String(roomId ?? '').trim();
  return `room_kind=eq.${kind}&room_id=eq.${rid}`;
}

export function chatReadPointerRoomIdsForRealtime(routeRoomId: string, canonicalRoomId?: string | null): string[] {
  const route = String(routeRoomId ?? '').trim();
  const canon = String(canonicalRoomId ?? '').trim();
  if (!route) return canon ? [canon] : [];
  if (!canon || canon === route) return [route];
  return [canon, route];
}

export type StartChatBubbleReadPointersRealtimeArgs = {
  roomKind: ChatRoomKindDelta;
  roomIds: readonly string[];
  uniqueKey: string;
  onChange: (payload?: ChatReadPointerRealtimePayload) => void;
  shouldStop: () => boolean;
  logLabel: string;
  /** @deprecated `realtimeCallbacks` 사용 */
  onError?: (message: string) => void;
  realtimeCallbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void);
  userErrorMessage: string;
  /** Realtime이 막혀도 말풍선 읽음을 맞추기 위한 폴백 RPC 간격(ms). 0이면 비활성. */
  pollIntervalMs?: number;
};

/**
 * `chat_read_pointers` postgres_changes — 방별 필터를 채널 하나에 여러 `.on()`으로 등록.
 * (과거 `room_id=eq."…"` 따옴표 필터는 이벤트가 오지 않는 경우가 있어 제거)
 */
export function startChatBubbleReadPointersRealtime(args: StartChatBubbleReadPointersRealtimeArgs): () => void {
  const roomIds = [...new Set(args.roomIds.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (roomIds.length === 0) return () => {};

  const channelBaseName = args.roomKind === 'social_dm' ? 'social-dm-bubble-read-pointers' : 'meeting-bubble-read-pointers';
  const onChange = (payload?: ChatReadPointerRealtimePayload) => {
    ginitNotifyDbg('BubbleRead', 'dedicated_read_pointers_channel_event', {
      logLabel: args.logLabel,
      roomKind: args.roomKind,
      roomIds,
    });
    args.onChange(payload);
  };

  const configure = (ch: RealtimeChannel) => {
    for (const rid of roomIds) {
      const filter = chatReadPointersPostgresFilter(args.roomKind, rid);
      if (__DEV__) console.log(`[${args.logLabel}] subscribe filter=${filter}`);
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_read_pointers', filter }, (payload) => {
        onChange({
          new: (payload as { new?: Record<string, unknown> }).new ?? null,
          old: (payload as { old?: Record<string, unknown> }).old ?? null,
        });
      });
    }
  };

  const rt = normalizeChatRealtimeSubscribeCallbacks(args.realtimeCallbacks ?? args.onError);
  const stopRealtime = startPostgresRealtimeSubscription({
    channelBaseName,
    uniqueKey: args.uniqueKey,
    configure,
    shouldStop: args.shouldStop,
    logLabel: args.logLabel,
    onTransientFailure: () => onChange(),
    ...postgresRealtimeHandlersFromChatCallbacks(rt, args.userErrorMessage),
  });

  const pollMs = args.pollIntervalMs ?? 0;
  const pollTimer =
    pollMs > 0
      ? setInterval(() => {
          if (args.shouldStop()) return;
          if (__DEV__) console.log(`[${args.logLabel}] poll fallback → schedule pull`);
          args.onChange();
        }, pollMs)
      : null;

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    stopRealtime();
  };
}
