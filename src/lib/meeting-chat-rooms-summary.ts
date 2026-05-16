import { Timestamp, type Unsubscribe } from '@/src/lib/ginit-timestamp';

import { normalizeParticipantId, readStoredUserId } from '@/src/lib/app-user-id';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { supabase } from '@/src/lib/supabase';
import {
  chatReadPointerRoomIdsForRealtime,
  startChatBubbleReadPointersRealtime,
} from '@/src/lib/chat-bubble-read-pointers-realtime';
import {
  applyChatReadPointerRealtimeToLocal,
  type ChatReadPointerRealtimePayload,
} from '@/src/lib/chat-read-pointer-realtime-local';
import {
  ensureSupabaseRealtimeAuthFromSession,
  getSupabaseAuthUserIdForRealtimeTopic,
} from '@/src/lib/supabase-realtime-resilience';
import {
  chatMarkReadCaughtUpRpc,
  chatMeetingRoomReadStatesForMeRpc,
  chatMeetingSummaryForMeRpc,
} from '@/src/lib/chat-supabase-delta';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { upsertLocalChatRoomReadState } from '@/src/lib/offline-chat/offline-chat-rooms';
import type { ChatRealtimeSubscribeCallbacks } from '@/src/lib/chat-realtime-subscribe-callbacks';
import { voidSafe } from '@/src/lib/void-safe';

export const MEETING_CHAT_ROOMS_COLLECTION = 'meeting_chat_rooms';

export type MeetingChatRoomSummaryDoc = {
  id: string;
  meetingId?: string;
  unreadCountBy?: Record<string, number | null | undefined>;
  lastMessageId?: string | null;
  lastMessageAt?: unknown | null;
  lastMessagePreview?: string | null;
  lastSenderId?: string | null;
  updatedAt?: unknown | null;
};

export function candidateUserKeys(userId: string): string[] {
  const raw = String(userId ?? '').trim();
  if (!raw) return [];
  const phone = (normalizePhoneUserId(raw) ?? '').trim();
  const pk = (normalizeParticipantId(raw) ?? '').trim();
  const out: string[] = [];
  const push = (v: string) => {
    const s = v.trim();
    if (!s) return;
    if (out.includes(s)) return;
    out.push(s);
  };
  push(phone || pk || raw);
  if (phone && phone !== out[0]) push(phone);
  if (pk && pk !== out[0] && pk !== phone) push(pk);
  if (raw && !out.includes(raw)) push(raw);
  return out;
}

/** Supabase `channel(topic)` 동일 토픽 재사용 시 `subscribe()` 이후 `.on()` 오류를 막기 위한 접미사. */
export function uniqueRealtimeChannelSuffix(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } };
  return typeof c.crypto?.randomUUID === 'function' ? c.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function summaryIsoToAt(iso: string | null | undefined): unknown {
  if (!iso || typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Timestamp.fromMillis(t);
}

function subscribeMeetingChatRoomSummarySupabase(
  meetingId: string,
  onSummary: (doc: MeetingChatRoomSummaryDoc | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    onSummary(null);
    return () => {};
  }
  let alive = true;

  const pull = async () => {
    const me = (await readStoredUserId())?.trim();
    if (!alive || !me) return;
    try {
      const s = await chatMeetingSummaryForMeRpc({ meAppUserId: me, meetingId: mid });
      if (s.error) {
        onError?.(s.error);
        return;
      }
      const unreadCountBy: Record<string, number | null | undefined> = {};
      for (const k of candidateUserKeys(me)) {
        unreadCountBy[k] = s.unread_count;
      }
      onSummary({
        id: mid,
        meetingId: mid,
        unreadCountBy,
        lastMessageId: s.last_message_id ?? null,
        lastMessageAt: summaryIsoToAt(s.last_message_at ?? null),
        lastMessagePreview: s.last_message_preview ?? null,
        lastSenderId: s.last_sender_id ?? null,
        updatedAt: summaryIsoToAt(s.updated_at ?? null) ?? Timestamp.now(),
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };

  voidSafe(
    (async () => {
      await pull();
      if (!alive) return;
    })(),
  );

  return () => {
    alive = false;
  };
}

export function subscribeMeetingChatRoomSummary(
  meetingId: string,
  onSummary: (doc: MeetingChatRoomSummaryDoc | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  return subscribeMeetingChatRoomSummarySupabase(meetingId, onSummary, onError);
}

export type PullMeetingChatReadPointersArgs = {
  meetingId: string;
  myAppUserId: string;
  ownerUserId?: string | null;
  /** 이미 알고 있으면 요약 RPC 생략(구독 루프에서 전달) */
  canonicalRoomId?: string | null;
  onMerged?: () => void;
};

const pullMeetingInflightByKey = new Map<string, Promise<void>>();
const pullMeetingDebounceTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
const pullMeetingPendingAfterInflightByKey = new Set<string>();
const pullMeetingReadersFingerprintByKey = new Map<string, string>();

function pullMeetingCoalesceKey(me: string, meetingId: string): string {
  return `${me}\0${meetingId}`;
}

/** `chat_meeting_room_read_states_for_me` 결과를 Watermelon `chat_rooms` 읽음 맵에 반영(라우트 id·canonical id 둘 다). */
async function pullMeetingChatReadPointersToLocalImpl(args: PullMeetingChatReadPointersArgs): Promise<void> {
  const mid = String(args.meetingId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!mid || !me) return;

  let canon = String(args.canonicalRoomId ?? '').trim();
  if (!canon) {
    try {
      const sum = await chatMeetingSummaryForMeRpc({ meAppUserId: me, meetingId: mid });
      if (!sum.error && sum.canonical_room_id?.trim()) canon = sum.canonical_room_id.trim();
    } catch {
      /* noop */
    }
  }

  let s: Awaited<ReturnType<typeof chatMeetingRoomReadStatesForMeRpc>>;
  try {
    s = await chatMeetingRoomReadStatesForMeRpc({ meAppUserId: me, meetingId: mid });
  } catch (e) {
    ginitNotifyDbg('BubbleRead', 'pull_rpc_throw', { meetingId: mid, message: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (s.error) {
    ginitNotifyDbg('BubbleRead', 'pull_rpc_error', { meetingId: mid, error: s.error });
    return;
  }
  if (s.readers.length === 0) {
    ginitNotifyDbg('BubbleRead', 'pull_rpc_empty_readers', { meetingId: mid });
    return;
  }

  const fpKey = pullMeetingCoalesceKey(me, mid);
  const fp = s.readers
    .map((r) => {
      const who = r.reader_app_user_id.trim();
      const seq =
        typeof r.last_read_seq === 'number' && Number.isFinite(r.last_read_seq) ? Math.floor(r.last_read_seq) : 0;
      const msg = (r.read_message_id ?? '').trim();
      return `${who}:${seq}:${msg}`;
    })
    .sort()
    .join('|');
  if (pullMeetingReadersFingerprintByKey.get(fpKey) === fp) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[GinitNotify:BubbleRead] pull_rpc_skip_unchanged', { meetingId: mid });
    }
    return;
  }
  pullMeetingReadersFingerprintByKey.set(fpKey, fp);

  ginitNotifyDbg('BubbleRead', 'pull_rpc_ok', { meetingId: mid, readerCount: s.readers.length });

  const readMessageIdBy: Record<string, unknown> = {};
  const readAtMsBy: Record<string, number> = {};
  const readLastSeqBy: Record<string, number> = {};
  let maxAt = 0;
  for (const r of s.readers) {
    const readerRaw = r.reader_app_user_id.trim();
    const rid = (normalizeParticipantId(readerRaw) || normalizePhoneUserId(readerRaw) || readerRaw).trim();
    if (!rid) continue;
    const msgId = r.read_message_id?.trim() ?? '';
    const seq =
      typeof r.last_read_seq === 'number' && Number.isFinite(r.last_read_seq) ? Math.max(0, Math.floor(r.last_read_seq)) : 0;
    let atMs = 0;
    if (r.updated_at?.trim()) {
      const t = Date.parse(r.updated_at);
      if (Number.isFinite(t)) atMs = t;
    }
    maxAt = Math.max(maxAt, atMs);
    if (msgId) readMessageIdBy[rid] = msgId;
    if (atMs > 0) readAtMsBy[rid] = atMs;
    if (seq > 0) readLastSeqBy[rid] = seq;
  }
  if (
    Object.keys(readMessageIdBy).length === 0 &&
    Object.keys(readAtMsBy).length === 0 &&
    Object.keys(readLastSeqBy).length === 0
  ) {
    return;
  }

  const roomKeys = [...new Set([mid, canon].filter((x) => x.length > 0))];
  for (const rid of roomKeys) {
    await upsertLocalChatRoomReadState({
      roomType: 'meeting',
      roomId: rid,
      ownerUserId: args.ownerUserId?.trim() ?? null,
      readMessageIdBy,
      readAtMsBy,
      readLastSeqBy,
      readStateLastAtMs: maxAt > 0 ? maxAt : undefined,
    });
  }
  ginitNotifyDbg('BubbleRead', 'wm_read_state_merged', {
    meetingId: mid,
    readers: s.readers.map((r) => ({
      who: r.reader_app_user_id.trim().slice(-12),
      seq: r.last_read_seq,
      msgSuffix: (r.read_message_id ?? '').trim().slice(-8) || null,
    })),
  });
  args.onMerged?.();
}

/** 동일 모임·사용자에 대한 동시 RPC 1회로 합칩니다. */
export function pullMeetingChatReadPointersToLocal(args: PullMeetingChatReadPointersArgs): Promise<void> {
  const mid = String(args.meetingId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!mid || !me) return Promise.resolve();
  const key = pullMeetingCoalesceKey(me, mid);
  const existing = pullMeetingInflightByKey.get(key);
  if (existing) return existing;
  const run = pullMeetingChatReadPointersToLocalImpl(args).finally(() => {
    if (pullMeetingInflightByKey.get(key) === run) pullMeetingInflightByKey.delete(key);
    if (pullMeetingPendingAfterInflightByKey.has(key)) {
      pullMeetingPendingAfterInflightByKey.delete(key);
      scheduleDebouncedPullMeetingChatReadPointers(args);
    }
  });
  pullMeetingInflightByKey.set(key, run);
  return run;
}

/** Realtime·메시지·읽음 RPC 후 pull 예약(방 단위 debounce). 구독 진입 직후 1회 pull은 직접 호출합니다. */
export function scheduleDebouncedPullMeetingChatReadPointers(
  args: PullMeetingChatReadPointersArgs,
  debounceMs = 300,
): void {
  const mid = String(args.meetingId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!mid || !me) return;
  const key = pullMeetingCoalesceKey(me, mid);
  const prev = pullMeetingDebounceTimerByKey.get(key);
  if (prev) clearTimeout(prev);
  pullMeetingDebounceTimerByKey.set(
    key,
    setTimeout(() => {
      pullMeetingDebounceTimerByKey.delete(key);
      if (pullMeetingInflightByKey.has(key)) {
        pullMeetingPendingAfterInflightByKey.add(key);
        return;
      }
      void pullMeetingChatReadPointersToLocal(args).catch(() => {});
    }, debounceMs),
  );
}

/**
 * 모임 방 `chat_read_pointers` Realtime 구독 → 말풍선 읽음 UI용 로컬 맵 갱신.
 * canonical `room_id`는 `chat_meeting_summary_for_me`로 맞춘 뒤 필터합니다.
 * 채널 토픽은 `meeting-bubble-read-pointers:{room}:{auth.users.id}` 형태(목록용 `chat_room_participants:*`와 분리).
 */
export function subscribeMeetingChatReadPointersRealtime(args: {
  meetingId: string;
  myAppUserId: string;
  ownerUserId?: string | null;
  /** @deprecated `realtimeCallbacks` */
  onError?: (message: string) => void;
  realtimeCallbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void);
  onReadPointersMerged?: () => void;
}): Unsubscribe {
  const mid = String(args.meetingId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!mid || !me) {
    return () => {};
  }
  let alive = true;
  let stopRealtime: (() => void) | null = null;
  let canonicalForPull = mid;

  let roomIdsForRealtime: string[] = [mid];

  const pullArgs = (): PullMeetingChatReadPointersArgs => ({
    meetingId: mid,
    myAppUserId: me,
    ownerUserId: args.ownerUserId,
    canonicalRoomId: canonicalForPull !== mid ? canonicalForPull : null,
    onMerged: args.onReadPointersMerged,
  });

  const schedulePull = () => {
    if (!alive) return;
    scheduleDebouncedPullMeetingChatReadPointers(pullArgs());
  };

  const onReadPointerRealtime = (payload?: ChatReadPointerRealtimePayload) => {
    if (!alive) return;
    void applyChatReadPointerRealtimeToLocal({
      roomKind: 'meeting',
      localRoomIds: roomIdsForRealtime,
      payload,
      ownerUserId: args.ownerUserId,
    })
      .then((patched) => {
        if (patched) args.onReadPointersMerged?.();
      })
      .catch(() => {})
      .finally(() => {
        schedulePull();
      });
  };

  voidSafe(
    (async () => {
    let canonical = mid;
    try {
      const s = await chatMeetingSummaryForMeRpc({ meAppUserId: me, meetingId: mid });
      if (!alive) return;
      if (s.error) {
        const rtErr = args.realtimeCallbacks ?? args.onError;
        if (typeof rtErr === 'function') rtErr(s.error);
        else rtErr?.onGiveUp?.(s.error);
        await pullMeetingChatReadPointersToLocal({
          meetingId: mid,
          myAppUserId: me,
          ownerUserId: args.ownerUserId,
          onMerged: args.onReadPointersMerged,
        }).catch(() => {});
        return;
      }
      if (s.canonical_room_id?.trim()) canonical = s.canonical_room_id.trim();
    } catch (e) {
      if (alive) {
        const msg = e instanceof Error ? e.message : String(e);
        const rtErr = args.realtimeCallbacks ?? args.onError;
        if (typeof rtErr === 'function') rtErr(msg);
        else rtErr?.onGiveUp?.(msg);
      }
      await pullMeetingChatReadPointersToLocal({
        meetingId: mid,
        myAppUserId: me,
        ownerUserId: args.ownerUserId,
        onMerged: args.onReadPointersMerged,
      }).catch(() => {});
      return;
    }

    canonicalForPull = canonical;
    roomIdsForRealtime = chatReadPointerRoomIdsForRealtime(mid, canonical);

    await pullMeetingChatReadPointersToLocal({
      meetingId: mid,
      myAppUserId: me,
      ownerUserId: args.ownerUserId,
      canonicalRoomId: canonical !== mid ? canonical : null,
      onMerged: args.onReadPointersMerged,
    }).catch(() => {});
    if (!alive) return;

    await ensureSupabaseRealtimeAuthFromSession();
    const authUserIdForTopic = await getSupabaseAuthUserIdForRealtimeTopic();
    /** `chat_room_participants:{appUserId}` 목록 구독과 분리 + JWT `sub`(UUID) 기반 토픽(표시용 이메일 혼선 방지). */
    const readPointersUniqueKey = authUserIdForTopic ? `${canonical}:${authUserIdForTopic}` : canonical;

    stopRealtime = startChatBubbleReadPointersRealtime({
      roomKind: 'meeting',
      roomIds: roomIdsForRealtime,
      uniqueKey: readPointersUniqueKey,
      onChange: onReadPointerRealtime,
      shouldStop: () => !alive,
      logLabel: 'meeting-bubble-read-pointers',
      realtimeCallbacks: args.realtimeCallbacks ?? args.onError,
      userErrorMessage: '모임 채팅 읽음 상태를 실시간으로 받지 못했어요.',
      pollIntervalMs: 0,
    });
    })(),
  );

  return () => {
    alive = false;
    const debKey = pullMeetingCoalesceKey(me, mid);
    const deb = pullMeetingDebounceTimerByKey.get(debKey);
    if (deb) {
      clearTimeout(deb);
      pullMeetingDebounceTimerByKey.delete(debKey);
    }
    stopRealtime?.();
  };
}

/** 레거시: 모임 채팅 요약은 Supabase `chat_messages`/RPC로 갱신됩니다. */
export async function bumpMeetingChatRoomSummaryOnSend(_args: {
  meetingId: string;
  senderId: string;
  messageId: string;
  preview: string;
  participantIds: (string | null | undefined)[];
}): Promise<void> {
  void _args;
}

export async function clearMeetingChatUnreadForUser(meetingId: string, userId: string): Promise<void> {
  const mid = String(meetingId ?? '').trim();
  const uid = String(userId ?? '').trim();
  if (!mid || !uid) return;

  const me = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  if (!me) return;
  void chatMarkReadCaughtUpRpc({ meAppUserId: me, roomKind: 'meeting', roomId: mid }).catch(() => {});
}
