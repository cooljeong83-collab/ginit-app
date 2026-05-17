import { getAppQueryClient } from '@/src/context/QueryClientPersistProvider';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import { scheduleChatBubbleReadPointersPull } from '@/src/lib/chat-bubble-read-pointers-pull';
import {
  applyRealtimeUnreadToLocalWatermelon,
  registerChatUnreadReconcileOnAppForeground,
  syncServerParticipantUnreadToLocalWatermelon,
} from '@/src/lib/chat-local-unread-sync';
import { resetChatUnreadBaseline } from '@/src/lib/chat-unread-baseline';
import { flushPendingChatReadOutbox } from '@/src/lib/chat-mark-read';
import { supabase } from '@/src/lib/supabase';
import { fetchSupabaseProfileRowIdByAppUserId } from '@/src/lib/supabase-profile-row-id';
import { ensureSupabaseRealtimeAuthFromSession } from '@/src/lib/supabase-realtime-resilience';
import { subscribeGlobalUserSyncChannel } from '@/src/lib/supabase-global-user-sync-channel';
import {
  parseUserChatUnreadCompositeRoomId,
  type UserChatUnreadWirePayload,
} from '@/src/lib/user-chat-list-broadcast';
import { publishChatListRefresh } from '@/src/lib/user-chat-list-refresh-bus';
import { publishUserUnreadBroadcast, type UserUnreadBroadcastPayload } from '@/src/lib/user-unread-broadcast-bus';

const broadcastReadPullTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** `unread_update` 수신 시 말풍선 읽음 맵도 보강(postgres_changes가 막혔을 때 대비). */
function scheduleBubbleReadPullFromBroadcast(
  roomKind: 'meeting' | 'social_dm',
  roomId: string,
  meAppUserId: string,
): void {
  const rid = roomId.trim();
  const me = meAppUserId.trim();
  if (!rid || !me) return;
  const key = `${roomKind}:${rid}`;
  const prev = broadcastReadPullTimers.get(key);
  if (prev) clearTimeout(prev);
  broadcastReadPullTimers.set(
    key,
    setTimeout(() => {
      broadcastReadPullTimers.delete(key);
      scheduleChatBubbleReadPointersPull({ roomKind, roomId: rid, myAppUserId: me });
    }, 400),
  );
}

function wireToNormKind(k: unknown): MeetingChatMessageKind {
  const s = typeof k === 'string' ? k.trim().toLowerCase() : '';
  if (s === 'image') return 'image';
  if (s === 'system') return 'system';
  return 'text';
}

function normalizeWirePayload(raw: UserChatUnreadWirePayload): UserUnreadBroadcastPayload | null {
  const parsed = parseUserChatUnreadCompositeRoomId(raw.room_id);
  if (!parsed) return null;
  const lastMessageId = typeof raw.last_message_id === 'string' ? raw.last_message_id.trim() : '';
  return {
    roomKind: parsed.roomKind,
    canonicalRoomId: parsed.roomId,
    lastMessage: typeof raw.last_message === 'string' ? raw.last_message : '',
    lastMessageId,
    messageKind: wireToNormKind(raw.message_kind),
    unreadCount:
      typeof raw.unread_count === 'number' && Number.isFinite(raw.unread_count)
        ? Math.max(0, Math.trunc(raw.unread_count))
        : 0,
  };
}

/**
 * 로그인 세션당 `user_notifications:{profiles.id}` 단일 구독.
 * @returns teardown
 */
export function startUserChatNotifications(appUserId: string): () => void {
  const uid = normalizeParticipantId(appUserId);
  if (!uid) return () => {};

  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  const unregisterForeground = registerChatUnreadReconcileOnAppForeground(uid);

  resetChatUnreadBaseline();
  void (async () => {
    await syncServerParticipantUnreadToLocalWatermelon(uid, { queryClient: getAppQueryClient() });
    await flushPendingChatReadOutbox(uid);
  })();

  void (async () => {
    const authed = await ensureSupabaseRealtimeAuthFromSession(5000);
    if (!authed) {
      if (__DEV__) console.warn('[user-chat-notifications] skip broadcast: no Supabase access_token (Realtime Unauthorized 방지)');
      return;
    }
    try {
      await supabase.rpc('ensure_profile_minimal', { p_app_user_id: uid });
    } catch {
      /* 프로필 행이 이미 있으면 무시 */
    }
    const profileRowId = await fetchSupabaseProfileRowIdByAppUserId(uid);
    if (cancelled || !profileRowId) {
      if (__DEV__ && !cancelled) console.warn('[user-chat-notifications] skip broadcast: no profiles.id for', uid.slice(0, 24));
      return;
    }

    unsubscribe = subscribeGlobalUserSyncChannel({
      profileRowId,
      appUserId: uid,
      queryClient: getAppQueryClient(),
      callbacks: {
        onUnreadUpdate: (wire) => {
          const norm = normalizeWirePayload(wire);
          if (!norm) return;
          publishUserUnreadBroadcast(norm);
          void applyRealtimeUnreadToLocalWatermelon(uid, norm);
          scheduleBubbleReadPullFromBroadcast(norm.roomKind, norm.canonicalRoomId, uid);
        },
        onRefreshList: () => publishChatListRefresh(),
      },
    });
  })();

  return () => {
    cancelled = true;
    for (const t of broadcastReadPullTimers.values()) clearTimeout(t);
    broadcastReadPullTimers.clear();
    try {
      unsubscribe?.();
    } catch {
      /* noop */
    }
    unregisterForeground();
  };
}
