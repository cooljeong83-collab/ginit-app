/**
 * Supabase 채팅 델타 RPC (마이그레이션 0135).
 * UI는 Supabase RPC(`chat_pull_deltas` 등)만 사용합니다.
 */
import { supabase } from '@/src/lib/supabase';

type SupabaseRpcInvoke<T> = { data: T | null; error: string | null };

/** fetch 단계 `TypeError: Network request failed` 포함 — throw 하지 않음 */
async function invokeSupabaseRpc<T>(
  run: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<SupabaseRpcInvoke<T>> {
  try {
    const { data, error } = await run();
    if (error?.message) return { data: null, error: error.message };
    return { data: data ?? null, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: msg };
  }
}

export type ChatRoomKindDelta = 'meeting' | 'social_dm';

export type ChatDeltaRow = {
  id: string;
  room_kind: ChatRoomKindDelta;
  room_id: string;
  seq: number;
  sender_app_user_id: string;
  kind: string;
  body_text: string | null;
  image_url: string | null;
  image_album_batch_id: string | null;
  reply_to: unknown;
  link_preview: unknown;
  client_mutation_id: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
};

export type ChatPullDeltasResult = {
  rows: ChatDeltaRow[];
  max_seq: number;
  has_more: boolean;
  canonical_room_id?: string;
  error?: string;
};

export async function chatPullDeltasRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  afterSeq: number;
  limit?: number;
}): Promise<ChatPullDeltasResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_pull_deltas', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_after_seq: args.afterSeq,
      p_limit: args.limit ?? 50,
    }),
  );
  if (error) {
    return { rows: [], max_seq: 0, has_more: false, error };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? (o.rows as ChatDeltaRow[]) : [];
  return {
    rows,
    max_seq: typeof o.max_seq === 'number' ? o.max_seq : Number(o.max_seq ?? 0),
    has_more: Boolean(o.has_more),
    canonical_room_id: typeof o.canonical_room_id === 'string' ? o.canonical_room_id : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export type ChatPullHistoryBeforeSeqResult = {
  rows: ChatDeltaRow[];
  min_seq: number | null;
  has_more: boolean;
  canonical_room_id?: string;
  error?: string;
};

export async function chatPullHistoryBeforeSeqRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  beforeSeq: number;
  limit?: number;
}): Promise<ChatPullHistoryBeforeSeqResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_pull_history_before_seq', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_before_seq: args.beforeSeq,
      p_limit: args.limit ?? 50,
    }),
  );
  if (error) {
    return { rows: [], min_seq: null, has_more: false, error };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? (o.rows as ChatDeltaRow[]) : [];
  const minRaw = o.min_seq;
  const min_seq =
    typeof minRaw === 'number' && Number.isFinite(minRaw)
      ? minRaw
      : minRaw != null && Number.isFinite(Number(minRaw))
        ? Number(minRaw)
        : null;
  return {
    rows,
    min_seq,
    has_more: Boolean(o.has_more),
    canonical_room_id: typeof o.canonical_room_id === 'string' ? o.canonical_room_id : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export type ChatPullTailResult = {
  rows: ChatDeltaRow[];
  max_seq: number | null;
  min_seq: number | null;
  has_more: boolean;
  canonical_room_id?: string;
  error?: string;
};

export async function chatPullTailRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  limit?: number;
}): Promise<ChatPullTailResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_pull_tail', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_limit: args.limit ?? 20,
    }),
  );
  if (error) {
    return { rows: [], max_seq: null, min_seq: null, has_more: false, error };
  }
  const o = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? (o.rows as ChatDeltaRow[]) : [];
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v != null && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  return {
    rows,
    max_seq: num(o.max_seq),
    min_seq: num(o.min_seq),
    has_more: Boolean(o.has_more),
    canonical_room_id: typeof o.canonical_room_id === 'string' ? o.canonical_room_id : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

/** `chat_send_message` 멱등 키 — 짧은 랜덤 폴백 포함 */
export function newChatClientMutationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export type ChatSendMessageResult = {
  ok: boolean;
  duplicate?: boolean;
  id?: string;
  seq?: number;
  error?: string;
};

export async function chatSendMessageRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  clientMutationId: string;
  kind: 'text' | 'image' | 'system';
  bodyText?: string | null;
  imageUrl?: string | null;
  imageAlbumBatchId?: string | null;
  replyTo?: Record<string, unknown> | null;
  linkPreview?: Record<string, unknown> | null;
}): Promise<ChatSendMessageResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_send_message', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_client_mutation_id: args.clientMutationId.trim(),
      p_kind: args.kind,
      p_body_text: args.bodyText ?? null,
      p_image_url: args.imageUrl ?? null,
      p_image_album_batch_id: args.imageAlbumBatchId ?? null,
      p_reply_to: args.replyTo ?? null,
      p_link_preview: args.linkPreview ?? null,
    }),
  );
  if (error) return { ok: false, error };
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(o.ok),
    duplicate: o.duplicate === true,
    id: typeof o.id === 'string' ? o.id : undefined,
    seq: typeof o.seq === 'number' ? o.seq : o.seq != null ? Number(o.seq) : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export async function chatMarkReadRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  lastReadSeq: number;
}): Promise<{ ok: boolean; last_read_seq?: number; error?: string }> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_mark_read', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_last_read_seq: args.lastReadSeq,
    }),
  );
  if (error) return { ok: false, error };
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(o.ok),
    last_read_seq: typeof o.last_read_seq === 'number' ? o.last_read_seq : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export type ChatMeetingSummaryForMeResult = {
  unread_count: number;
  last_message_id?: string | null;
  last_message_preview?: string | null;
  last_sender_id?: string | null;
  last_message_at?: string | null;
  updated_at?: string | null;
  canonical_room_id?: string;
  error?: string;
};

export async function chatMeetingSummaryForMeRpc(args: {
  meAppUserId: string;
  meetingId: string;
}): Promise<ChatMeetingSummaryForMeResult> {
  const mid = args.meetingId.trim();
  if (mid.startsWith('social_')) {
    return { unread_count: 0, error: 'invalid_meeting_id' };
  }
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_meeting_summary_for_me', {
      p_me: args.meAppUserId.trim(),
      p_meeting_id: mid,
    }),
  );
  if (error) return { unread_count: 0, error };
  const o = (data ?? {}) as Record<string, unknown>;
  const uc = o.unread_count;
  return {
    unread_count: typeof uc === 'number' && Number.isFinite(uc) ? uc : Number(uc ?? 0) || 0,
    last_message_id: typeof o.last_message_id === 'string' ? o.last_message_id : o.last_message_id == null ? null : String(o.last_message_id),
    last_message_preview: typeof o.last_message_preview === 'string' ? o.last_message_preview : null,
    last_sender_id: typeof o.last_sender_id === 'string' ? o.last_sender_id : o.last_sender_id == null ? null : String(o.last_sender_id),
    last_message_at: typeof o.last_message_at === 'string' ? o.last_message_at : null,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : null,
    canonical_room_id: typeof o.canonical_room_id === 'string' ? o.canonical_room_id : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export type ChatMeetingRoomReadStateRow = {
  reader_app_user_id: string;
  last_read_seq: number;
  read_message_id: string | null;
  updated_at: string | null;
};

export type ChatMeetingRoomReadStatesForMeResult = {
  readers: ChatMeetingRoomReadStateRow[];
  error?: string;
};

function parseChatRoomReadStatesForMePayload(data: unknown): ChatMeetingRoomReadStatesForMeResult {
  const o = (data ?? {}) as Record<string, unknown>;
  if (typeof o.error === 'string' && o.error.trim()) {
    return { readers: [], error: o.error.trim() };
  }
  const raw = o.readers;
  const readers: ChatMeetingRoomReadStateRow[] = Array.isArray(raw)
    ? raw
        .map((row): ChatMeetingRoomReadStateRow | null => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
          const r = row as Record<string, unknown>;
          const rid = typeof r.reader_app_user_id === 'string' ? r.reader_app_user_id.trim() : String(r.reader_app_user_id ?? '').trim();
          if (!rid) return null;
          const seqRaw = r.last_read_seq;
          const last_read_seq =
            typeof seqRaw === 'number' && Number.isFinite(seqRaw)
              ? Math.floor(seqRaw)
              : Number.isFinite(Number(seqRaw))
                ? Math.floor(Number(seqRaw))
                : 0;
          const read_message_id =
            typeof r.read_message_id === 'string' && r.read_message_id.trim()
              ? r.read_message_id.trim()
              : r.read_message_id != null
                ? String(r.read_message_id).trim() || null
                : null;
          const updated_at =
            typeof r.updated_at === 'string' && r.updated_at.trim()
              ? r.updated_at.trim()
              : r.updated_at != null
                ? String(r.updated_at)
                : null;
          return { reader_app_user_id: rid, last_read_seq, read_message_id, updated_at };
        })
        .filter((x): x is ChatMeetingRoomReadStateRow => x != null)
    : [];
  return { readers };
}

export async function chatMeetingRoomReadStatesForMeRpc(args: {
  meAppUserId: string;
  meetingId: string;
}): Promise<ChatMeetingRoomReadStatesForMeResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_meeting_room_read_states_for_me', {
      p_me: args.meAppUserId.trim(),
      p_meeting_id: args.meetingId.trim(),
    }),
  );
  if (error) return { readers: [], error };
  return parseChatRoomReadStatesForMePayload(data);
}

/** DM 방 참가자 전원의 `chat_read_pointers` → 말풍선 상대 읽음 UI용. */
export async function chatSocialRoomReadStatesForMeRpc(args: {
  meAppUserId: string;
  roomId: string;
}): Promise<ChatMeetingRoomReadStatesForMeResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_social_room_read_states_for_me', {
      p_me: args.meAppUserId.trim(),
      p_room_id: args.roomId.trim(),
    }),
  );
  if (error) return { readers: [], error };
  return parseChatRoomReadStatesForMePayload(data);
}

export type ChatSocialRoomSnapshotResult = {
  participant_ids: string[];
  unread_count: number;
  read_last_message_id?: string | null;
  last_message_id?: string | null;
  last_message_preview?: string | null;
  last_sender_id?: string | null;
  last_message_at?: string | null;
  updated_at?: string | null;
  room_last_message_at?: string | null;
  error?: string;
};

export async function chatSocialRoomSnapshotForMeRpc(args: {
  meAppUserId: string;
  roomId: string;
}): Promise<ChatSocialRoomSnapshotResult> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_social_room_snapshot_for_me', {
      p_me: args.meAppUserId.trim(),
      p_room_id: args.roomId.trim(),
    }),
  );
  if (error) return { participant_ids: [], unread_count: 0, error };
  const o = (data ?? {}) as Record<string, unknown>;
  const rawIds = o.participant_ids;
  const participant_ids = Array.isArray(rawIds)
    ? rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : [];
  const uc = o.unread_count;
  return {
    participant_ids,
    unread_count: typeof uc === 'number' && Number.isFinite(uc) ? uc : Number(uc ?? 0) || 0,
    read_last_message_id: typeof o.read_last_message_id === 'string' ? o.read_last_message_id : null,
    last_message_id: typeof o.last_message_id === 'string' ? o.last_message_id : null,
    last_message_preview: typeof o.last_message_preview === 'string' ? o.last_message_preview : null,
    last_sender_id: typeof o.last_sender_id === 'string' ? o.last_sender_id : null,
    last_message_at: typeof o.last_message_at === 'string' ? o.last_message_at : null,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : null,
    room_last_message_at: typeof o.room_last_message_at === 'string' ? o.room_last_message_at : null,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export async function chatMarkReadCaughtUpRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
}): Promise<{ ok: boolean; last_read_seq?: number; error?: string }> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_mark_read_caught_up', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
    }),
  );
  if (error) return { ok: false, error };
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(o.ok),
    last_read_seq: typeof o.last_read_seq === 'number' ? o.last_read_seq : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export async function chatSoftDeleteMessageRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  messageId: string;
  mode: 'text' | 'image';
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_soft_delete_message', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_message_id: args.messageId.trim(),
      p_mode: args.mode,
    }),
  );
  if (error) return { ok: false, error };
  const o = (data ?? {}) as Record<string, unknown>;
  return { ok: Boolean(o.ok), error: typeof o.error === 'string' ? o.error : undefined };
}

export async function chatSearchMessagesForMeRpc(args: {
  meAppUserId: string;
  roomKind: ChatRoomKindDelta;
  roomId: string;
  needle: string;
  maxScan?: number;
  matchLimit?: number;
}): Promise<{ rows: ChatDeltaRow[]; error?: string }> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_search_messages_for_me', {
      p_me: args.meAppUserId.trim(),
      p_room_kind: args.roomKind,
      p_room_id: args.roomId.trim(),
      p_needle: args.needle.trim(),
      p_max_scan: args.maxScan ?? 2500,
      p_match_limit: args.matchLimit ?? 80,
    }),
  );
  if (error) return { rows: [], error };
  const o = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? (o.rows as ChatDeltaRow[]) : [];
  return { rows, error: typeof o.error === 'string' ? o.error : undefined };
}

export async function chatEnsureSocialDmRoomRpc(args: {
  meAppUserId: string;
  roomId: string;
  peerA: string;
  peerB: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_ensure_social_dm_room', {
      p_me: args.meAppUserId.trim(),
      p_room_id: args.roomId.trim(),
      p_peer_a: args.peerA.trim(),
      p_peer_b: args.peerB.trim(),
    }),
  );
  if (error) return { ok: false, error };
  const o = (data ?? {}) as Record<string, unknown>;
  return { ok: Boolean(o.ok), error: typeof o.error === 'string' ? o.error : undefined };
}

export async function chatDeleteAllMeetingMessagesRpc(args: {
  meAppUserId: string;
  meetingId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await invokeSupabaseRpc(() =>
    supabase.rpc('chat_delete_all_meeting_messages', {
      p_me: args.meAppUserId.trim(),
      p_meeting_id: args.meetingId.trim(),
    }),
  );
  if (error) return { ok: false, error };
  const o = (data ?? {}) as Record<string, unknown>;
  return { ok: Boolean(o.ok), error: typeof o.error === 'string' ? o.error : undefined };
}
