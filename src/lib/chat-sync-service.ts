/**
 * 채팅(Chat) 도메인 전용 — Watermelon `chat_rooms`(UI 소스) + `['chat', 'rooms', …]` TanStack 스냅샷.
 * **모임** 쿼리 키(`['meetings', …]`)는 절대 수정하지 않는다 (`meeting-sync-service` 참고).
 */
import type { QueryClient } from '@tanstack/react-query';
import { Q } from '@nozbe/watermelondb';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { upsertMeetingUnreadAcrossLocalRoomIds } from '@/src/lib/chat-meeting-room-id-mirror';
import { reconcileServerUnreadWithLocal, shouldSkipParticipantUnreadBump } from '@/src/lib/chat-unread-apply-guard';
import { markRecentUnreadBroadcast, wasRecentUnreadBroadcast } from '@/src/lib/chat-unread-recent-broadcast';
import { chatRoomsListQueryKey } from '@/src/lib/chat-query-keys';
import { unreadCountForChatRoomListRow, upsertLocalChatRoomSummary } from '@/src/lib/offline-chat/offline-chat-rooms';
import { database } from '@/src/watermelon';

export type ChatRoomParticipantRow = {
  room_kind: string;
  room_id: string;
  unread_count: number;
  updated_at: string | null;
  /** Realtime/RPC에 컬럼이 있을 때만 채움. 없으면 캐시 병합 시 기존 값 유지 */
  last_message_preview: string | null;
};

export type ChatRoomsRealtimeSnapshot = {
  /** UI·디버그용 단조 증가 */
  rev: number;
  /** 키: `${room_kind}:${room_id}` */
  participants: Record<string, ChatRoomParticipantRow>;
};

export function emptyChatRoomsRealtimeSnapshot(): ChatRoomsRealtimeSnapshot {
  return { rev: 0, participants: {} };
}

export function participantRowKey(roomKind: string, roomId: string): string {
  return `${roomKind.trim().toLowerCase()}:${roomId.trim()}`;
}

function parseLastMessagePreview(record: Record<string, unknown>): string | null {
  const keys = ['last_message_preview', 'last_message', 'lastMessagePreview', 'lastMessage'] as const;
  for (const k of keys) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export function parseUnreadCountField(raw: unknown): number {
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }
  if (raw != null && Number.isFinite(Number(raw))) return Math.max(0, Math.trunc(Number(raw)));
  return 0;
}

function parseParticipantPayload(record: Record<string, unknown>): ChatRoomParticipantRow | null {
  const rk = typeof record.room_kind === 'string' ? record.room_kind.trim().toLowerCase() : '';
  const rid = typeof record.room_id === 'string' ? record.room_id.trim() : '';
  if (!rid || (rk !== 'meeting' && rk !== 'social_dm')) return null;
  const unread = parseUnreadCountField(record.unread_count);
  const updated_at = typeof record.updated_at === 'string' ? record.updated_at : null;
  const last_message_preview = parseLastMessagePreview(record);
  return { room_kind: rk, room_id: rid, unread_count: unread, updated_at, last_message_preview };
}

/** `['chat','rooms',userId]` 스냅샷만 갱신 — meetings 캐시 미사용 */
export function mergeChatRoomParticipantIntoQueryCache(
  queryClient: QueryClient,
  rawOwnerUserId: string,
  row: ChatRoomParticipantRow,
): void {
  const uid = normalizeParticipantId(rawOwnerUserId);
  if (!uid) return;
  const key = chatRoomsListQueryKey(uid);
  const pk = participantRowKey(row.room_kind, row.room_id);
  queryClient.setQueryData<ChatRoomsRealtimeSnapshot>(key, (prev) => {
    const base = prev ?? emptyChatRoomsRealtimeSnapshot();
    const prevRow = base.participants[pk];
    const merged: ChatRoomParticipantRow = {
      ...row,
      last_message_preview: row.last_message_preview ?? prevRow?.last_message_preview ?? null,
    };
    if (
      prevRow &&
      prevRow.unread_count === merged.unread_count &&
      (prevRow.updated_at ?? '') === (merged.updated_at ?? '') &&
      (prevRow.last_message_preview ?? '').trim() === (merged.last_message_preview ?? '').trim()
    ) {
      return base;
    }
    return {
      rev: base.rev + 1,
      participants: { ...base.participants, [pk]: merged },
    };
  });
}

function parseUpdatedAtMs(iso: string | null | undefined): number {
  if (!iso || typeof iso !== 'string') return Date.now();
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * Supabase `chat_room_participants` 한 행 → Watermelon `chat_rooms` upsert.
 * `owner_user_id`는 항상 `normalizeParticipantId` 결과로 저장해 목록·배지·Realtime 필터와 동일 키를 씁니다.
 * 탭 배지·채팅 목록(`useLocalChatRoomSummaries` / `useChatRoomListEngine`)은 이 로컬 DB 변경으로 반응합니다.
 *
 * `source: 'rpc'`일 때: Realtime보다 먼저 도착한 오래된 `unread_count=0` 스냅샷이 방금 올라간 미읽음을 지우지 않게 가드합니다.
 * @returns Watermelon upsert를 수행했으면 `true`, RPC 가드로 스킵했으면 `false`
 */
export async function syncRoomParticipantToLocalDb(
  ownerUserId: string,
  row: ChatRoomParticipantRow,
  opts?: { source?: 'realtime' | 'rpc' },
): Promise<boolean> {
  const raw = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
  const me = normalizeParticipantId(raw) || raw;
  if (!me) return false;
  const serverAt = parseUpdatedAtMs(row.updated_at);
  const now = Date.now();
  const remoteAt = Math.max(serverAt, now);
  const uc = row.unread_count;
  const roomType = row.room_kind === 'meeting' ? 'meeting' : 'social_dm';

  if (
    uc > 0 &&
    (await shouldSkipParticipantUnreadBump({
      meAppUserId: me,
      roomKind: roomType,
      roomId: row.room_id,
      serverUnread: uc,
    }))
  ) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[chat-sync-service] skip_participant_unread_bump', {
        source: opts?.source,
        room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
        unread: uc,
      });
    }
    return false;
  }

  if (opts?.source === 'realtime') {
    const db = database;
    if (db) {
      const existing = await db.get('chat_rooms').query(Q.where('room_id', row.room_id), Q.where('room_type', roomType)).fetch();
      const r0 = existing[0] as
        | {
            lastMessagePreview?: string | null;
            remoteUpdatedAtMs?: number | null;
          }
        | undefined;
      if (r0) {
        const localUr = unreadCountForChatRoomListRow(r0);
        const lp = typeof r0.lastMessagePreview === 'string' ? r0.lastMessagePreview.trim() : '';
        const rp = row.last_message_preview?.trim() ?? '';
        const localRu =
          typeof r0.remoteUpdatedAtMs === 'number' && Number.isFinite(r0.remoteUpdatedAtMs)
            ? Math.floor(r0.remoteUpdatedAtMs)
            : 0;
        if (localUr === uc && lp === rp && localRu >= serverAt) {
          return false;
        }
      }
    }
  }

  const db = database;
  const fromServer = opts?.source === 'rpc' || opts?.source === 'realtime';
  const existingForGuard =
    db && fromServer
      ? ((await db.get('chat_rooms').query(Q.where('room_id', row.room_id), Q.where('room_type', roomType)).fetch())[0] as
          | { remoteUpdatedAtMs?: number | null }
          | undefined)
      : undefined;

  if (fromServer) {
    const rk = roomType === 'meeting' ? 'meeting' : 'social_dm';
    if (wasRecentUnreadBroadcast(rk, row.room_id)) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[chat-sync-service] skip_participant_sync_after_unread_broadcast', {
          source: opts?.source,
          room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
          unread: uc,
        });
      }
      return false;
    }
    if (existingForGuard) {
      const localUr = unreadCountForChatRoomListRow(existingForGuard);
      const localRu =
        typeof existingForGuard.remoteUpdatedAtMs === 'number' && Number.isFinite(existingForGuard.remoteUpdatedAtMs)
          ? Math.floor(existingForGuard.remoteUpdatedAtMs)
          : 0;
      if (localUr > 0 && uc < localUr && serverAt <= localRu) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[chat-sync-service] skip_participant_sync_stale_unread_downgrade', {
            source: opts?.source,
            room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
            localUr,
            serverUnread: uc,
            serverAt,
            localRu,
          });
        }
        return false;
      }
    }
  }

  if (uc === 0) {
    if (existingForGuard) {
      const localUr = unreadCountForChatRoomListRow(existingForGuard);
      const localRu =
        typeof existingForGuard.remoteUpdatedAtMs === 'number' && Number.isFinite(existingForGuard.remoteUpdatedAtMs)
          ? Math.floor(existingForGuard.remoteUpdatedAtMs)
          : 0;
      if (localUr > 0 && serverAt < localRu) {
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log('[chat-sync-service] skip_stale_unread_zero', {
            source: opts?.source ?? 'unknown',
            room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
            localUr,
            serverAt,
            localRu,
          });
        }
        return false;
      }
    }
  }

  /** 서버 unread>0일 때 forceServerUnread를 쓰면 이후 낙관적 0 등과의 순서에 따라 잘못 덮일 수 있어, 0일 때만 강제한다. */
  const forceServerUnread = uc === 0;
  const unreadLastAtMs = uc > 0 ? Math.max(serverAt, now) : serverAt;
  const unreadToApply =
    uc > 0
      ? await reconcileServerUnreadWithLocal({
          meAppUserId: me,
          roomKind: roomType,
          roomId: row.room_id,
          serverUnread: uc,
        })
      : 0;
  if (__DEV__ && uc > 0 && unreadToApply !== uc) {
    // eslint-disable-next-line no-console
    console.log('[chat-sync-service] reconcile_unread_participant', {
      source: opts?.source,
      room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
      server: uc,
      local: unreadToApply,
    });
  }
  if (roomType === 'meeting') {
    await upsertMeetingUnreadAcrossLocalRoomIds(me, row.room_id, {
      ownerUserId: me,
      unreadCount: unreadToApply,
      lastMessagePreview: row.last_message_preview ?? undefined,
      unreadLastAtMs,
      remoteUpdatedAtMs: remoteAt,
      forceServerUnread,
      touchListSurface: true,
    });
  } else {
    await upsertLocalChatRoomSummary({
      roomType,
      roomId: row.room_id,
      ownerUserId: me,
      isGroup: false,
      unreadCount: unreadToApply,
      lastMessagePreview: row.last_message_preview ?? undefined,
      unreadLastAtMs,
      remoteUpdatedAtMs: remoteAt,
      forceServerUnread: unreadToApply === 0,
      touchListSurface: true,
    });
  }
  if (unreadToApply > 0) {
    markRecentUnreadBroadcast(roomType === 'meeting' ? 'meeting' : 'social_dm', row.room_id);
  }
  return true;
}

export async function applyChatRoomParticipantRealtimePayload(
  queryClient: QueryClient,
  ownerUserId: string,
  record: Record<string, unknown>,
): Promise<void> {
  const row = parseParticipantPayload(record);
  if (!row) return;
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[chat-sync-service] realtime chat_room_participants → localDb+snapshot', {
      room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
      unread: row.unread_count,
      hasPreview: Boolean(row.last_message_preview),
    });
  }
  const applied = await syncRoomParticipantToLocalDb(ownerUserId, row, { source: 'realtime' });
  if (__DEV__ && applied) {
    // eslint-disable-next-line no-console
    console.log('[chat-sync-service] realtime → Watermelon upsert done', {
      room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
    });
  }
  mergeChatRoomParticipantIntoQueryCache(queryClient, ownerUserId, row);
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[chat-sync-service] realtime → TanStack snapshot merged', {
      room: `${row.room_kind}:${row.room_id.slice(0, 12)}…`,
      skippedWm: !applied,
    });
  }
}
