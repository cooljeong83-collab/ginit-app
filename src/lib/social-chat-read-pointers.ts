import { type Unsubscribe } from '@/src/lib/ginit-timestamp';

import { chatSocialRoomReadStatesForMeRpc } from '@/src/lib/chat-supabase-delta';
import { startChatBubbleReadPointersRealtime } from '@/src/lib/chat-bubble-read-pointers-realtime';
import {
  applyChatReadPointerRealtimeToLocal,
  type ChatReadPointerRealtimePayload,
} from '@/src/lib/chat-read-pointer-realtime-local';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { upsertLocalChatRoomReadState } from '@/src/lib/offline-chat/offline-chat-rooms';
import {
  ensureSupabaseRealtimeAuthFromSession,
  getSupabaseAuthUserIdForRealtimeTopic,
} from '@/src/lib/supabase-realtime-resilience';
import type { ChatRealtimeSubscribeCallbacks } from '@/src/lib/chat-realtime-subscribe-callbacks';
import { voidSafe } from '@/src/lib/void-safe';

type PullSocialReadPointersArgs = {
  roomId: string;
  myAppUserId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  onMerged?: () => void;
};

const pullInflightByKey = new Map<string, Promise<void>>();
const pullDebounceTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();

function pullCoalesceKey(me: string, rid: string): string {
  return `${me}\0${rid}`;
}

/** `chat_social_room_read_states_for_me` → Watermelon `chat_rooms` 읽음 맵(말풍선·상대 읽음). `unread_count` 등 목록 필드는 건드리지 않습니다. */
async function pullSocialChatReadPointersToLocalImpl(args: PullSocialReadPointersArgs): Promise<void> {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) return;

  let s: Awaited<ReturnType<typeof chatSocialRoomReadStatesForMeRpc>>;
  try {
    s = await chatSocialRoomReadStatesForMeRpc({ meAppUserId: me, roomId: rid });
  } catch (e) {
    ginitNotifyDbg('BubbleRead', 'pull_rpc_throw', { roomId: rid, message: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (s.error) {
    ginitNotifyDbg('BubbleRead', 'pull_rpc_error', { roomId: rid, error: s.error });
    return;
  }
  if (s.readers.length === 0) {
    ginitNotifyDbg('BubbleRead', 'pull_rpc_empty_readers', { roomId: rid });
    return;
  }
  ginitNotifyDbg('BubbleRead', 'pull_rpc_ok', { roomId: rid, readerCount: s.readers.length });

  const readMessageIdBy: Record<string, unknown> = {};
  const readAtMsBy: Record<string, number> = {};
  const readLastSeqBy: Record<string, number> = {};
  let maxAt = 0;
  for (const r of s.readers) {
    const readerRaw = r.reader_app_user_id.trim();
    const readerId = (normalizeParticipantId(readerRaw) || normalizePhoneUserId(readerRaw) || readerRaw).trim();
    if (!readerId) continue;
    const msgId = r.read_message_id?.trim() ?? '';
    const seq =
      typeof r.last_read_seq === 'number' && Number.isFinite(r.last_read_seq) ? Math.max(0, Math.floor(r.last_read_seq)) : 0;
    let atMs = 0;
    if (r.updated_at?.trim()) {
      const t = Date.parse(r.updated_at);
      if (Number.isFinite(t)) atMs = t;
    }
    maxAt = Math.max(maxAt, atMs);
    if (msgId) readMessageIdBy[readerId] = msgId;
    if (atMs > 0) readAtMsBy[readerId] = atMs;
    if (seq > 0) readLastSeqBy[readerId] = seq;
  }
  if (
    Object.keys(readMessageIdBy).length === 0 &&
    Object.keys(readAtMsBy).length === 0 &&
    Object.keys(readLastSeqBy).length === 0
  ) {
    return;
  }

  await upsertLocalChatRoomReadState({
    roomType: 'social_dm',
    roomId: rid,
    ownerUserId: args.ownerUserId?.trim() ?? null,
    peerUserId: args.peerUserId === undefined ? undefined : String(args.peerUserId ?? '').trim() || null,
    readMessageIdBy,
    readAtMsBy,
    readLastSeqBy,
    readStateLastAtMs: maxAt > 0 ? maxAt : undefined,
  });
  ginitNotifyDbg('BubbleRead', 'wm_read_state_merged', {
    roomId: rid,
    readers: s.readers.map((r) => ({
      who: r.reader_app_user_id.trim().slice(-12),
      seq: r.last_read_seq,
      msgSuffix: (r.read_message_id ?? '').trim().slice(-8) || null,
    })),
  });
  args.onMerged?.();
}

/** 동일 방·사용자에 대한 동시 RPC 1회로 합칩니다. */
export function pullSocialChatReadPointersToLocal(args: PullSocialReadPointersArgs): Promise<void> {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) return Promise.resolve();
  const key = pullCoalesceKey(me, rid);
  const existing = pullInflightByKey.get(key);
  if (existing) return existing;
  const run = pullSocialChatReadPointersToLocalImpl(args).finally(() => {
    if (pullInflightByKey.get(key) === run) pullInflightByKey.delete(key);
  });
  pullInflightByKey.set(key, run);
  return run;
}

/** Realtime·메시지 이벤트 후 RPC pull 예약(방 단위 debounce). */
export function scheduleDebouncedPullSocialChatReadPointers(args: PullSocialReadPointersArgs, debounceMs = 200): void {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) return;
  const key = pullCoalesceKey(me, rid);
  const prev = pullDebounceTimerByKey.get(key);
  if (prev) clearTimeout(prev);
  pullDebounceTimerByKey.set(
    key,
    setTimeout(() => {
      pullDebounceTimerByKey.delete(key);
      void pullSocialChatReadPointersToLocal(args).catch(() => {});
    }, debounceMs),
  );
}

/**
 * DM 방 `chat_read_pointers` Realtime 구독 → 말풍선 읽음 UI용 로컬 맵 갱신.
 * 채널 토픽은 `social-dm-bubble-read-pointers:{room}:{auth.users.id}` 형태(목록용 구독과 분리).
 */
export function subscribeSocialChatReadPointersRealtime(args: {
  roomId: string;
  myAppUserId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  /** @deprecated `realtimeCallbacks` */
  onError?: (message: string) => void;
  realtimeCallbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void);
  onReadPointersMerged?: () => void;
}): Unsubscribe {
  const rid = String(args.roomId ?? '').trim();
  const me = String(args.myAppUserId ?? '').trim();
  if (!rid || !me) {
    return () => {};
  }

  let alive = true;
  let stopRealtime: (() => void) | null = null;

  const localRoomIds = [rid];

  const pullArgs = (): PullSocialReadPointersArgs => ({
    roomId: rid,
    myAppUserId: me,
    ownerUserId: args.ownerUserId,
    peerUserId: args.peerUserId,
    onMerged: args.onReadPointersMerged,
  });

  const schedulePull = () => {
    if (!alive) return;
    scheduleDebouncedPullSocialChatReadPointers(pullArgs());
  };

  const onReadPointerRealtime = (payload?: ChatReadPointerRealtimePayload) => {
    if (!alive) return;
    void applyChatReadPointerRealtimeToLocal({
      roomKind: 'social_dm',
      localRoomIds,
      payload,
      ownerUserId: args.ownerUserId,
      peerUserId: args.peerUserId,
    })
      .then((patched) => {
        if (patched) args.onReadPointersMerged?.();
      })
      .catch(() => {})
      .finally(() => {
        /** 즉시 패치 실패·seq만 온 경우에도 RPC로 `read_message_id`까지 맞춤(상대 읽기만 한 경우). */
        schedulePull();
      });
  };

  voidSafe(
    (async () => {
    await pullSocialChatReadPointersToLocal({
      roomId: rid,
      myAppUserId: me,
      ownerUserId: args.ownerUserId,
      peerUserId: args.peerUserId,
      onMerged: args.onReadPointersMerged,
    }).catch(() => {});
    if (!alive) return;

    await ensureSupabaseRealtimeAuthFromSession();
    const authUserIdForTopic = await getSupabaseAuthUserIdForRealtimeTopic();
    const readPointersUniqueKey = authUserIdForTopic ? `${rid}:${authUserIdForTopic}` : rid;

    stopRealtime = startChatBubbleReadPointersRealtime({
      roomKind: 'social_dm',
      roomIds: [rid],
      uniqueKey: readPointersUniqueKey,
      onChange: onReadPointerRealtime,
      shouldStop: () => !alive,
      logLabel: 'social-dm-bubble-read-pointers',
      realtimeCallbacks: args.realtimeCallbacks ?? args.onError,
      userErrorMessage: '친구 채팅 읽음 상태를 실시간으로 받지 못했어요.',
      pollIntervalMs: 0,
    });
    })(),
  );

  return () => {
    alive = false;
    const debKey = pullCoalesceKey(me, rid);
    const deb = pullDebounceTimerByKey.get(debKey);
    if (deb) {
      clearTimeout(deb);
      pullDebounceTimerByKey.delete(debKey);
    }
    stopRealtime?.();
  };
}
