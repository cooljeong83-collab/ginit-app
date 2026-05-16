/**
 * 로그인 세션 Realtime — **채널 역할 분리**
 * - `user_notifications:{profiles.id}`: Edge Broadcast만(채팅 미읽음·목록 refresh). **프로필 postgres_changes 없음.**
 * - `global_user_sync:{profiles.id}`: `chat_room_participants`·`friends` postgres_changes → Watermelon/버스
 */
import type { QueryClient } from '@tanstack/react-query';

import { applyChatRoomParticipantRealtimePayload } from '@/src/lib/chat-sync-service';
import { emitFriendsPostgresChanged } from '@/src/lib/friends-postgres-sync-bus';
import { friendsRealtimeEqFilter } from '@/src/lib/supabase-friends-realtime';
import { formatRealtimeSubscribeDetail } from '@/src/lib/supabase-realtime-resilience';
import { isSupabaseProfileRowUuid } from '@/src/lib/supabase-profile-row-id';
import { supabase } from '@/src/lib/supabase';
import {
  USER_CHAT_REFRESH_LIST_BROADCAST_EVENT,
  USER_CHAT_UNREAD_BROADCAST_EVENT,
  type SubscribeUserChatBroadcastCallbacks,
} from '@/src/lib/user-chat-list-broadcast';

const LOG_BROADCAST = 'user-notifications';
const LOG_POSTGRES = 'global-user-sync';

export type SubscribeGlobalUserSyncChannelParams = {
  profileRowId: string;
  appUserId: string;
  queryClient: QueryClient;
  callbacks: SubscribeUserChatBroadcastCallbacks;
};

function subscribeUserNotificationsBroadcastChannel(
  profileRowId: string,
  callbacks: SubscribeUserChatBroadcastCallbacks,
): () => void {
  const pid = profileRowId.toLowerCase();
  let cancelled = false;
  const topic = `user_notifications:${pid}`;
  const channel = supabase.channel(topic, { config: { private: true } });

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[${LOG_BROADCAST}] realtime: broadcast channel topic=${topic}`);
  }

  channel.on('broadcast', { event: USER_CHAT_UNREAD_BROADCAST_EVENT }, (msg) => {
    if (cancelled) return;
    const raw = msg?.payload;
    if (!raw || typeof raw !== 'object') return;
    const p = raw as Record<string, unknown>;
    const room_id = typeof p.room_id === 'string' ? p.room_id.trim() : '';
    if (!room_id) return;
    const last_message = typeof p.last_message === 'string' ? p.last_message : '';
    const ur = p.unread_count;
    const unread_count =
      typeof ur === 'number' && Number.isFinite(ur) ? Math.max(0, Math.trunc(ur)) : 0;
    const last_message_id = typeof p.last_message_id === 'string' ? p.last_message_id.trim() : undefined;
    const message_kind = typeof p.message_kind === 'string' ? p.message_kind : undefined;
    callbacks.onUnreadUpdate({ room_id, last_message, unread_count, last_message_id, message_kind });
  });

  if (callbacks.onRefreshList) {
    channel.on('broadcast', { event: USER_CHAT_REFRESH_LIST_BROADCAST_EVENT }, () => {
      if (cancelled) return;
      callbacks.onRefreshList?.();
    });
  }

  void channel.subscribe((status, err) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[${LOG_BROADCAST}] realtime: ${formatRealtimeSubscribeDetail(status, err)} topic=${topic}`);
    }
    if (status === 'CHANNEL_ERROR') {
      callbacks.onChannelError?.('Supabase Realtime(알림 브로드캐스트) 연결 오류');
    }
  });

  return () => {
    cancelled = true;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[${LOG_BROADCAST}] realtime: teardown → removeChannel topic=${topic}`);
    }
    void supabase.removeChannel(channel);
  };
}

function subscribeGlobalUserPostgresSyncChannel(
  profileRowId: string,
  appUserId: string,
  queryClient: QueryClient,
): () => void {
  const pid = profileRowId.toLowerCase();
  const me = appUserId.trim();
  if (!me) return () => {};

  let cancelled = false;
  const topic = `global_user_sync:${pid}`;
  const channel = supabase.channel(topic, { config: { private: true } });

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[${LOG_POSTGRES}] realtime: postgres channel topic=${topic}`);
  }

  const participantFilter = `app_user_id=eq.${me}`;
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'chat_room_participants', filter: participantFilter },
    (payload) => {
      if (cancelled) return;
      const rec = (payload.new ?? payload.old) as Record<string, unknown> | null;
      if (!rec || typeof rec !== 'object') return;
      void (async () => {
        try {
          await applyChatRoomParticipantRealtimePayload(queryClient, me, rec);
        } catch (e) {
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.warn(`[${LOG_POSTGRES}] chat_room_participants apply failed`, e);
          }
        }
      })();
    },
  );

  const fireFriends = () => {
    if (!cancelled) emitFriendsPostgresChanged();
  };
  const events = ['INSERT', 'UPDATE', 'DELETE'] as const;
  const filters = [
    friendsRealtimeEqFilter('requester_app_user_id', me),
    friendsRealtimeEqFilter('addressee_app_user_id', me),
  ] as const;
  for (const event of events) {
    for (const filter of filters) {
      channel.on('postgres_changes', { event, schema: 'public', table: 'friends', filter }, fireFriends);
    }
  }

  void channel.subscribe((status, err) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[${LOG_POSTGRES}] realtime: ${formatRealtimeSubscribeDetail(status, err)} topic=${topic}`);
    }
    if (status === 'SUBSCRIBED') {
      fireFriends();
    }
  });

  return () => {
    cancelled = true;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[${LOG_POSTGRES}] realtime: teardown → removeChannel topic=${topic}`);
    }
    void supabase.removeChannel(channel);
  };
}

/**
 * Broadcast + postgres 멀티플렉스(서로 다른 토픽·채널).
 * @returns teardown — 두 채널 모두 `removeChannel`
 */
export function subscribeGlobalUserSyncChannel(params: SubscribeGlobalUserSyncChannelParams): () => void {
  const rawPid = typeof params.profileRowId === 'string' ? params.profileRowId.trim() : '';
  if (!isSupabaseProfileRowUuid(rawPid)) {
    return () => {};
  }
  const pid = rawPid.toLowerCase();

  const stopBroadcast = subscribeUserNotificationsBroadcastChannel(pid, params.callbacks);
  const stopPostgres = subscribeGlobalUserPostgresSyncChannel(pid, params.appUserId, params.queryClient);

  return () => {
    stopBroadcast();
    stopPostgres();
  };
}
