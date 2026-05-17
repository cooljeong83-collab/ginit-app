/**
 * 채팅 미읽음: Supabase Realtime 수신 시 **목록 전체 fetch 없이** Watermelon `chat_rooms`만 패치하고,
 * 부트·포그라운드에서 서버 `chat_room_participants`와 최종 동기화합니다.
 */
import type { QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { getAppQueryClient } from '@/src/context/QueryClientPersistProvider';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';
import {
  mergeChatRoomParticipantIntoQueryCache,
  parseUnreadCountField,
  syncRoomParticipantToLocalDb,
  type ChatRoomParticipantRow,
} from '@/src/lib/chat-sync-service';
import { upsertMeetingUnreadAcrossLocalRoomIds } from '@/src/lib/chat-meeting-room-id-mirror';
import { upsertSocialDmListSurfaceAcrossLocalRoomIds } from '@/src/lib/chat-social-room-id-mirror';
import { markChatUnreadBaselineReady } from '@/src/lib/chat-unread-baseline';
import {
  isChatRoomOpenForUnreadApply,
  reconcileServerUnreadWithLocal,
  shouldSkipUnreadBroadcastApply,
} from '@/src/lib/chat-unread-apply-guard';
import { markRecentUnreadBroadcast } from '@/src/lib/chat-unread-recent-broadcast';
import { flushPendingChatReadOutbox } from '@/src/lib/chat-mark-read';
import { upsertLocalChatRoomSummary } from '@/src/lib/offline-chat/offline-chat-rooms';
import { supabase } from '@/src/lib/supabase';
import type { UserUnreadBroadcastPayload } from '@/src/lib/user-unread-broadcast-bus';

type ParticipantPullRow = {
  room_kind?: string;
  room_id?: string;
  unread_count?: unknown;
  updated_at?: string | null;
  last_message_preview?: string | null;
  last_message?: string | null;
};

function parseRpcRows(data: unknown): ParticipantPullRow[] {
  if (Array.isArray(data)) return data as ParticipantPullRow[];
  if (typeof data === 'string' && data.trim()) {
    try {
      const parsed = JSON.parse(data) as unknown;
      return Array.isArray(parsed) ? (parsed as ParticipantPullRow[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Realtime `unread_update`(Edge `chat-user-notifications-broadcast`) → Watermelon `chat_rooms` 한 방만 갱신.
 * 페이로드는 **목록용** `unread_count`·최근 메시지 스텁 중심이며, `message_read_*` JSON(말풍선 읽음)은 포함하지 않습니다.
 * 상대 읽음 맵은 `chat_read_pointers` Realtime + `pullMeetingChatReadPointersToLocal` 경로로만 반영됩니다.
 */
export async function applyRealtimeUnreadToLocalWatermelon(
  ownerUserId: string,
  p: UserUnreadBroadcastPayload,
): Promise<void> {
  const uid = normalizeParticipantId(ownerUserId) || ownerUserId.trim();
  if (!uid) return;

  if (
    await shouldSkipUnreadBroadcastApply({
      meAppUserId: uid,
      roomKind: p.roomKind,
      roomId: p.canonicalRoomId,
      serverUnread: p.unreadCount,
      serverLastMessageId: p.lastMessageId,
    })
  ) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[chat-local-unread-sync] skip_unread_broadcast_apply', {
        roomKind: p.roomKind,
        roomId: p.canonicalRoomId.slice(-20),
        unread: p.unreadCount,
      });
    }
    return;
  }

  const now = Date.now();
  const unreadCount = await reconcileServerUnreadWithLocal({
    meAppUserId: uid,
    roomKind: p.roomKind,
    roomId: p.canonicalRoomId,
    serverUnread: p.unreadCount,
    serverLastMessageId: p.lastMessageId,
  });
  if (__DEV__ && unreadCount !== p.unreadCount) {
    // eslint-disable-next-line no-console
    console.log('[chat-local-unread-sync] reconcile_unread_broadcast', {
      roomId: p.canonicalRoomId.slice(-20),
      server: p.unreadCount,
      local: unreadCount,
    });
  }

  if (p.roomKind === 'meeting') {
    await upsertMeetingUnreadAcrossLocalRoomIds(uid, p.canonicalRoomId, {
      ownerUserId: uid,
      unreadCount,
      lastMessagePreview: p.lastMessage,
      lastMessageId: p.lastMessageId || undefined,
      lastMessageAtMs: now,
      lastMessageKind: p.messageKind,
      remoteUpdatedAtMs: now,
      unreadLastAtMs: now,
      forceServerUnread: true,
      touchListSurface: true,
    });
    markRecentUnreadBroadcast('meeting', p.canonicalRoomId);
    return;
  }
  await upsertSocialDmListSurfaceAcrossLocalRoomIds(uid, p.canonicalRoomId, {
    ownerUserId: uid,
    unreadCount,
    lastMessagePreview: p.lastMessage,
    lastMessageId: p.lastMessageId || undefined,
    lastMessageAtMs: now,
    lastMessageKind: p.messageKind,
    remoteUpdatedAtMs: now,
    unreadLastAtMs: now,
    forceServerUnread: true,
    touchListSurface: true,
  });
  markRecentUnreadBroadcast('social_dm', p.canonicalRoomId);
}

export type SyncChatUnreadCachesOpts = {
  /** 있으면 `['chat','rooms',…]` 스냅샷에 수술적 병합(모임 feed 캐시는 건드리지 않음) */
  queryClient?: QueryClient;
};

function rowFromPullRpc(r: ParticipantPullRow): ChatRoomParticipantRow | null {
  const rk = typeof r.room_kind === 'string' ? r.room_kind.trim().toLowerCase() : '';
  const rid = typeof r.room_id === 'string' ? r.room_id.trim() : '';
  if (!rid || (rk !== 'meeting' && rk !== 'social_dm')) return null;
  const ur = r.unread_count;
  const unread = parseUnreadCountField(ur);
  const updated_at = typeof r.updated_at === 'string' ? r.updated_at : null;
  const lmp =
    typeof r.last_message_preview === 'string' && r.last_message_preview.trim()
      ? r.last_message_preview.trim()
      : typeof r.last_message === 'string' && r.last_message.trim()
        ? r.last_message.trim()
        : null;
  return { room_kind: rk, room_id: rid, unread_count: unread, updated_at, last_message_preview: lmp };
}

/**
 * 서버 `fetch_my_chat_unread_counts`(또는 `chat_room_participants_pull_for_me`) 결과로
 * 로컬 `unread_count` + 선택적으로 TanStack `['chat','rooms']` 스냅샷을 맞춤.
 * `forceServerUnread`로 로컬 타임스탬프 가드(shouldApplyUnreadUpdate)를 우회합니다.
 */
export async function syncServerParticipantUnreadToLocalWatermelon(
  appUserId: string,
  opts?: SyncChatUnreadCachesOpts,
): Promise<{ rooms: number; error?: string }> {
  const me = appUserId.trim();
  if (!me) return { rooms: 0 };

  const qc = opts?.queryClient;

  try {
    const alias = await supabase.rpc('fetch_my_chat_unread_counts' as never);
    let data: unknown;
    let error = alias.error;
    if (error) {
      const pull = await supabase.rpc('chat_room_participants_pull_for_me', { p_me: me });
      data = pull.data;
      error = pull.error;
    } else {
      data = alias.data;
    }

    if (error) {
      if (__DEV__) console.warn('[chat-local-unread-sync] unread RPC', error.message);
      return { rooms: 0, error: error.message };
    }

    const rows = parseRpcRows(data);
    let n = 0;
    for (const r of rows) {
      const row = rowFromPullRpc(r);
      if (!row) continue;
      const applied = await syncRoomParticipantToLocalDb(me, row, { source: 'rpc' });
      if (applied && qc) {
        mergeChatRoomParticipantIntoQueryCache(qc, me, row);
      }
      n += 1;
    }
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[chat-local-unread-sync] RPC → caches reconciled rooms=${n} tanstack=${Boolean(qc)}`);
    }
    return { rooms: n };
  } finally {
    markChatUnreadBaselineReady();
  }
}

/**
 * 현재 방 1건에 대해 서버 `chat_room_participants` 행을 SELECT(RLS 본인 행) 후 로컬·TanStack에 반영.
 * 방 진입 직후 tail/요약이 비어 있어도 탭·목록 unread가 서버와 맞도록 부트스트랩합니다.
 */
export async function syncServerParticipantUnreadForRoom(
  appUserId: string,
  roomKind: ChatRoomKindDelta,
  roomId: string,
  opts?: SyncChatUnreadCachesOpts,
): Promise<boolean> {
  const me = normalizeParticipantId(appUserId.trim()) || appUserId.trim();
  const rid = roomId.trim();
  if (!me || !rid) return false;
  const rk = roomKind === 'social_dm' ? 'social_dm' : 'meeting';
  const qc = opts?.queryClient;

  if (await isChatRoomOpenForUnreadApply(me, rk, rid)) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[chat-local-unread-sync] skip_single_room_sync_while_open', { roomKind: rk, roomId: rid.slice(-20) });
    }
    return false;
  }

  const { data, error } = await supabase
    .from('chat_room_participants')
    .select('room_kind, room_id, unread_count, updated_at')
    .eq('app_user_id', me)
    .eq('room_kind', rk)
    .eq('room_id', rid)
    .maybeSingle();

  if (error) {
    if (__DEV__) console.warn('[chat-local-unread-sync] single-room participant', error.message);
    return false;
  }
  if (!data || typeof data !== 'object') return false;

  const row = rowFromPullRpc(data as ParticipantPullRow);
  if (!row) return false;
  const applied = await syncRoomParticipantToLocalDb(me, row, { source: 'rpc' });
  if (applied && qc) mergeChatRoomParticipantIntoQueryCache(qc, me, row);
  return applied;
}

/** 앱 포그라운드 복귀 시 과도한 RPC 방지(실시간 끊김 복구는 수 초 단위로 충분) */
const foregroundThrottleMs = 5_000;
let lastForegroundSyncAt = 0;
let foregroundSub: { remove: () => void } | null = null;

/** 앱이 active로 돌아올 때(실시간 끊김 복구 포함) 서버 unread와 로컬을 주기적으로 맞춤. */
export function registerChatUnreadReconcileOnAppForeground(appUserId: string): () => void {
  const me = appUserId.trim();
  if (!me) return () => {};

  if (foregroundSub) {
    try {
      foregroundSub.remove();
    } catch {
      /* noop */
    }
    foregroundSub = null;
  }

  const onChange = (s: AppStateStatus) => {
    if (s !== 'active') return;
    const now = Date.now();
    if (now - lastForegroundSyncAt < foregroundThrottleMs) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[chat-local-unread-sync] foreground reconcile skipped (throttle)');
      }
      return;
    }
    lastForegroundSyncAt = now;
    void (async () => {
      await syncServerParticipantUnreadToLocalWatermelon(me, { queryClient: getAppQueryClient() });
      await flushPendingChatReadOutbox(me);
    })();
  };

  foregroundSub = AppState.addEventListener('change', onChange);
  return () => {
    try {
      foregroundSub?.remove();
    } catch {
      /* noop */
    }
    foregroundSub = null;
  };
}
