/**
 * 1:1 소셜 DM — Supabase `chat_messages` + RPC(`chat_pull_tail`, `chat_send_message` 등).
 * `room_kind: 'social_dm'` 로 모임 채팅과 구분합니다.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Timestamp, type Unsubscribe } from '@/src/lib/ginit-timestamp';
import { Platform } from 'react-native';

import { normalizeParticipantId, readStoredUserId } from '@/src/lib/app-user-id';
import { candidateUserKeys } from '@/src/lib/meeting-chat-rooms-summary';
import { buildLinkPreviewForChatText } from '@/src/lib/chat-link-preview-for-send';
import {
  chatEnsureSocialDmRoomRpc,
  chatMarkReadRpc,
  chatPullHistoryBeforeSeqRpc,
  chatPullTailRpc,
  chatSearchMessagesForMeRpc,
  chatSendMessageRpc,
  chatSocialRoomSnapshotForMeRpc,
  chatSoftDeleteMessageRpc,
  newChatClientMutationId,
  type ChatDeltaRow,
} from '@/src/lib/chat-supabase-delta';
import { chatReadPointersPostgresFilter } from '@/src/lib/chat-bubble-read-pointers-realtime';
import { applyChatReadPointerRealtimeToLocal } from '@/src/lib/chat-read-pointer-realtime-local';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import {
  pullSocialChatReadPointersToLocal,
  scheduleDebouncedPullSocialChatReadPointers,
} from '@/src/lib/social-chat-read-pointers';
import {
  ensureSupabaseRealtimeAuthFromSession,
  getSupabaseAuthUserIdForRealtimeTopic,
} from '@/src/lib/supabase-realtime-resilience';
import { normalizeMeetingChatLinkPreview } from '@/src/lib/chat-link-preview-normalize';
import type { MeetingChatLinkPreview, MeetingChatMessage, MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { fetchChatRoomsListPageFromSupabase } from '@/src/lib/supabase-chat-rooms-list';
import { subscribeChatListRefresh } from '@/src/lib/user-chat-list-refresh-bus';
import { supabase } from '@/src/lib/supabase';
import {
  normalizeChatRealtimeSubscribeCallbacks,
  postgresRealtimeHandlersFromChatCallbacks,
  type ChatRealtimeSubscribeCallbacks,
} from '@/src/lib/chat-realtime-subscribe-callbacks';
import { voidSafe } from '@/src/lib/void-safe';
import { startPostgresRealtimeSubscription } from '@/src/lib/supabase-realtime-resilience';
import { getSocialChatImageUploadQuality } from '@/src/lib/social-chat-image-quality-preference';
import {
  SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';
import { sanitizeUnicodeForSqliteStorage } from '@/src/lib/offline-chat/offline-chat-utils';
import { fetchBlockedPeerIds, isPeerBlockedByMe } from '@/src/lib/user-blocks';
import { getUserProfile } from '@/src/lib/user-profile';

export const CHAT_ROOMS_COLLECTION = 'chat_rooms';
export const SOCIAL_CHAT_MESSAGES_SUBCOLLECTION = 'messages';

export type {
  SocialChatMessage,
  SocialChatReplyTo,
  SocialChatRoomDoc,
  SocialChatRoomSummary,
} from '@/src/lib/social-chat-types';
export { isSocialDmChatRoomId, socialDmPreviewLine } from '@/src/lib/social-chat-types';

import type { SocialChatMessage, SocialChatReplyTo, SocialChatRoomDoc, SocialChatRoomSummary } from '@/src/lib/social-chat-types';

export const SOCIAL_CHAT_PAGE_SIZE = 20;
const SOCIAL_LATEST_PREVIEW_LIMIT = 1;
const SOCIAL_CHAT_UNREAD_LIST_CAP = 999;

function isoStringToSocialTimestamp(iso: string | null | undefined): Timestamp {
  const t = typeof iso === 'string' && iso.trim() ? Date.parse(iso.trim()) : NaN;
  return Timestamp.fromMillis(Number.isFinite(t) ? t : Date.now());
}

function mapChatDeltaRowToSocialMessage(row: ChatDeltaRow): SocialChatMessage {
  const id = String(row.id ?? '').trim();
  const createdAt = isoStringToSocialTimestamp(row.created_at);
  const updatedAt = row.updated_at ? isoStringToSocialTimestamp(row.updated_at) : createdAt;
  const deletedAt = row.deleted_at ? isoStringToSocialTimestamp(row.deleted_at) : null;
  const kindRaw = row.kind;
  const kind: MeetingChatMessageKind | undefined =
    kindRaw === 'system' ? 'system' : kindRaw === 'image' ? 'image' : kindRaw === 'text' ? 'text' : undefined;
  const text = typeof row.body_text === 'string' ? row.body_text : '';
  const imageUrl = typeof row.image_url === 'string' && row.image_url.trim() ? row.image_url.trim() : null;
  const imageAlbumBatchId =
    typeof row.image_album_batch_id === 'string' && row.image_album_batch_id.trim()
      ? row.image_album_batch_id.trim()
      : null;
  const senderId =
    typeof row.sender_app_user_id === 'string' && row.sender_app_user_id.trim()
      ? row.sender_app_user_id.trim()
      : null;
  const rt = row.reply_to;
  let replyTo: SocialChatReplyTo | null = null;
  if (rt && typeof rt === 'object' && !Array.isArray(rt)) {
    const r = rt as Record<string, unknown>;
    const rk = r.kind;
    const replyKind: MeetingChatMessageKind | undefined =
      rk === 'system' ? 'system' : rk === 'image' ? 'image' : rk === 'text' ? 'text' : undefined;
    replyTo = {
      messageId: typeof r.messageId === 'string' ? String(r.messageId) : '',
      senderId:
        typeof r.senderId === 'string' ? String(r.senderId) : r.senderId == null ? null : String(r.senderId),
      kind: replyKind,
      imageUrl:
        typeof r.imageUrl === 'string' ? String(r.imageUrl) : r.imageUrl == null ? null : String(r.imageUrl ?? ''),
      text: typeof r.text === 'string' ? String(r.text) : '',
    };
  }
  const linkPreview = normalizeMeetingChatLinkPreview(row.link_preview);
  return {
    id,
    senderId,
    text,
    kind,
    imageUrl,
    imageAlbumBatchId,
    linkPreview,
    replyTo: replyTo?.messageId ? replyTo : null,
    createdAt,
    updatedAt,
    deletedAt,
  };
}

export function socialMessageTimeMs(m: SocialChatMessage | null | undefined): number {
  const ts = m?.createdAt as Timestamp | null | undefined;
  if (!ts || typeof ts.toMillis !== 'function') return 0;
  try {
    return ts.toMillis();
  } catch {
    return 0;
  }
}

export function socialMessageToMeetingMessage(m: SocialChatMessage): MeetingChatMessage {
  return {
    id: m.id,
    senderId: m.senderId,
    text: m.text,
    kind: (m.kind ?? 'text') as MeetingChatMessageKind,
    imageUrl: m.imageUrl ?? null,
    imageAlbumBatchId: m.imageAlbumBatchId ?? null,
    linkPreview: m.linkPreview ?? null,
    replyTo: m.replyTo?.messageId
      ? {
          messageId: m.replyTo.messageId,
          senderId: m.replyTo.senderId ?? null,
          kind: m.replyTo.kind,
          imageUrl: m.replyTo.imageUrl ?? null,
          text: m.replyTo.text,
        }
      : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt ?? null,
    deletedAt: m.deletedAt ?? null,
  };
}

export function socialMessagesToMeetingNewestFirst(rows: SocialChatMessage[]): MeetingChatMessage[] {
  const copy = [...rows];
  copy.reverse();
  return copy.map(socialMessageToMeetingMessage);
}

export function socialDmRoomId(userA: string, userB: string): string {
  const x = (normalizePhoneUserId(userA) ?? userA).trim();
  const y = (normalizePhoneUserId(userB) ?? userB).trim();
  if (!x || !y || x === y) throw new Error('유효한 상대가 필요합니다.');
  const [a, b] = x < y ? [x, y] : [y, x];
  return `social_${a}__${b}`;
}

export function isValidSocialDmPeerForViewer(meAppUserId: string, peerAppUserId: string): boolean {
  const x = (normalizePhoneUserId(meAppUserId) ?? meAppUserId).trim();
  const y = (normalizePhoneUserId(peerAppUserId) ?? peerAppUserId).trim();
  return Boolean(x && y && x !== y);
}

/** 목록·네비 — 실패 시 `social_` roomId 폴백, 없으면 빈 문자열(행 스킵). */
export function resolveSocialDmRoomIdForViewer(
  meAppUserId: string,
  peerAppUserId: string,
  fallbackRoomId?: string,
): string {
  if (isValidSocialDmPeerForViewer(meAppUserId, peerAppUserId)) {
    return socialDmRoomId(meAppUserId, peerAppUserId);
  }
  const fb = fallbackRoomId?.trim();
  return fb?.startsWith('social_') ? fb : '';
}

export function parsePeerFromSocialRoomId(roomId: string, meAppUserId: string): string | null {
  const rid = roomId.trim();
  const me = (normalizePhoneUserId(meAppUserId) ?? meAppUserId).trim();
  if (!rid.startsWith('social_') || !me) return null;
  const inner = rid.slice('social_'.length);
  const idx = inner.indexOf('__');
  if (idx <= 0) return null;
  const a = inner.slice(0, idx);
  const b = inner.slice(idx + 2);
  if (a === me) return b || null;
  if (b === me) return a || null;
  return null;
}

function socialSnapshotIsoToTimestamp(iso: string | null | undefined): Timestamp | null {
  if (!iso || typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Timestamp.fromMillis(t);
}

export async function ensureSocialChatRoomDoc(roomId: string, participantA: string, participantB: string): Promise<void> {
  const rid = roomId.trim();
  const a = (normalizePhoneUserId(participantA) ?? participantA).trim();
  const b = (normalizePhoneUserId(participantB) ?? participantB).trim();
  if (!rid || !a || !b) return;
  const raw = (await readStoredUserId())?.trim();
  if (!raw) return;
  const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
  if (!me) return;
  try {
    const res = await chatEnsureSocialDmRoomRpc({
      meAppUserId: me,
      roomId: rid,
      peerA: a,
      peerB: b,
    });
    if (!res.ok && __DEV__ && res.error) {
      console.warn('[social-chat] chat_ensure_social_dm_room', res.error);
    }
  } catch (e) {
    if (__DEV__) console.warn('[social-chat] chat_ensure_social_dm_room', e);
  }
}

export async function fetchSocialChatRoomDocOnce(
  roomId: string,
  rawMe: string,
  onError?: (message: string) => void,
): Promise<SocialChatRoomDoc | null> {
  const rid = roomId.trim();
  const me = (normalizeParticipantId(rawMe) || normalizePhoneUserId(rawMe) || rawMe).trim();
  if (!rid || !me) return null;
  try {
    const s = await chatSocialRoomSnapshotForMeRpc({ meAppUserId: me, roomId: rid });
    if (s.error) {
      onError?.(s.error);
      return null;
    }
    const unreadCountBy: Record<string, number | null | undefined> = {};
    for (const k of candidateUserKeys(me)) {
      unreadCountBy[k] = s.unread_count;
    }
    const readMessageIdBy: Record<string, string | null | undefined> = {};
    const readAtBy: Record<string, unknown> = {};
    const readId = s.read_last_message_id?.trim() ? s.read_last_message_id.trim() : '';
    if (readId) {
      const ts = socialSnapshotIsoToTimestamp(s.updated_at) ?? Timestamp.now();
      for (const k of candidateUserKeys(me)) {
        readMessageIdBy[k] = readId;
        readAtBy[k] = ts;
      }
    }
    const updatedAt =
      socialSnapshotIsoToTimestamp(s.room_last_message_at ?? s.last_message_at ?? s.updated_at) ??
      socialSnapshotIsoToTimestamp(s.updated_at) ??
      Timestamp.now();
    return {
      id: rid,
      isGroup: false,
      participantIds: s.participant_ids.length ? s.participant_ids : undefined,
      readMessageIdBy: Object.keys(readMessageIdBy).length ? readMessageIdBy : undefined,
      readAtBy: Object.keys(readAtBy).length ? readAtBy : undefined,
      unreadCountBy,
      updatedAt,
    };
  } catch (e) {
    onError?.(e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function subscribeSocialChatRoom(
  roomId: string,
  onRoom: (room: SocialChatRoomDoc | null) => void,
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): Unsubscribe {
  const rt = normalizeChatRealtimeSubscribeCallbacks(callbacks);
  const rid = roomId.trim();
  if (!rid) {
    onRoom(null);
    return () => {};
  }
  let alive = true;
  let stopRealtime: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const schedulePull = () => {
    if (!alive) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      voidSafe(pull());
    }, 200);
  };

  const scheduleReadPointersPull = () => {
    if (!alive) return;
    voidSafe(async () => {
      const raw = (await readStoredUserId())?.trim();
      if (!alive || !raw) return;
      const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
      if (!me) return;
      scheduleDebouncedPullSocialChatReadPointers({ roomId: rid, myAppUserId: me });
    });
  };

  const onReadPointersPostgresChange = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
    if (!alive) return;
    voidSafe(async () => {
      const raw = (await readStoredUserId())?.trim();
      if (!alive || !raw) return;
      const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
      if (!me) return;
      await applyChatReadPointerRealtimeToLocal({
        roomKind: 'social_dm',
        localRoomIds: [rid],
        payload,
      });
      scheduleDebouncedPullSocialChatReadPointers({ roomId: rid, myAppUserId: me });
    });
  };

  const pull = async () => {
    try {
      const raw = (await readStoredUserId())?.trim();
      if (!alive || !raw) return;
      const doc = await fetchSocialChatRoomDocOnce(rid, raw, rt.onGiveUp);
      if (doc && alive) onRoom(doc);
    } catch (e) {
      rt.onGiveUp?.(e instanceof Error ? e.message : String(e));
    }
  };

  voidSafe(
    (async () => {
    await pull();
    if (!alive) return;
    await ensureSupabaseRealtimeAuthFromSession();
    const authUserIdForTopic = await getSupabaseAuthUserIdForRealtimeTopic();
    const channelUniqueKey = authUserIdForTopic ? `${rid}:${authUserIdForTopic}` : rid;
    const msgFilter = `room_id=eq.${rid}`;
    const roomFilter = `id=eq.${rid}`;
    const readPointersFilter = chatReadPointersPostgresFilter('social_dm', rid);
    stopRealtime = startPostgresRealtimeSubscription({
      channelBaseName: 'social-chat-room',
      uniqueKey: channelUniqueKey,
      configure: (ch) => {
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_messages', filter: msgFilter },
          () => {
            schedulePull();
            scheduleReadPointersPull();
          },
        );
        ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_rooms', filter: roomFilter }, schedulePull);
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_read_pointers', filter: readPointersFilter },
          onReadPointersPostgresChange,
        );
      },
      shouldStop: () => !alive,
      logLabel: 'social-chat-room',
      onTransientFailure: () => {
        schedulePull();
        scheduleReadPointersPull();
      },
      ...postgresRealtimeHandlersFromChatCallbacks(rt, '채팅방 정보를 불러오지 못했어요.'),
    });
    })(),
  );

  /** 이탈 시 `startPostgresRealtimeSubscription` → `removeChannel`로 방 전용 Realtime 정리. */
  return () => {
    alive = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    stopRealtime?.();
  };
}

export async function updateSocialChatReadReceipt(roomId: string, myAppUserId: string, lastReadMessageId: string): Promise<void> {
  const rid = roomId.trim();
  const raw = String(myAppUserId ?? '').trim();
  const msgId = String(lastReadMessageId ?? '').trim();
  if (!rid || !raw || !msgId || msgId.startsWith('local:')) return;
  const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
  if (!me) return;
  const { data: row, error } = await supabase
    .from('chat_messages')
    .select('seq')
    .eq('id', msgId)
    .eq('room_kind', 'social_dm')
    .eq('room_id', rid)
    .maybeSingle();
  if (error) {
    ginitNotifyDbg('BubbleRead', 'mark_read_seq_lookup_error', { roomId: rid, message: error.message });
    return;
  }
  if (!row) {
    ginitNotifyDbg('BubbleRead', 'mark_read_seq_lookup_miss', { roomId: rid, msgSuffix: msgId.slice(-8) });
    return;
  }
  const seqRaw = (row as { seq?: unknown }).seq;
  const seq = typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? seqRaw : Number(seqRaw);
  if (!Number.isFinite(seq) || seq <= 0) {
    ginitNotifyDbg('BubbleRead', 'mark_read_invalid_seq', { roomId: rid, seq: String(seqRaw) });
    return;
  }
  const res = await chatMarkReadRpc({ meAppUserId: me, roomKind: 'social_dm', roomId: rid, lastReadSeq: Math.floor(seq) });
  if (!res.ok) {
    ginitNotifyDbg('BubbleRead', 'chat_mark_read_fail', { roomId: rid, error: res.error ?? 'unknown' });
    if (__DEV__) console.warn('[social-chat] chat_mark_read', res.error);
    return;
  }
  ginitNotifyDbg('BubbleRead', 'chat_mark_read_ok', { roomId: rid, lastReadSeq: Math.floor(seq) });
  scheduleDebouncedPullSocialChatReadPointers({ roomId: rid, myAppUserId: me });
}

export async function searchSocialChatMessages(
  roomId: string,
  needle: string,
  opts?: { maxDocsScanned?: number },
): Promise<SocialChatMessage[]> {
  const rid = roomId.trim();
  const raw = typeof needle === 'string' ? needle.trim() : '';
  if (!rid || !raw) return [];

  const me = (await readStoredUserId())?.trim();
  if (!me) return [];
  const maxDocs = Math.min(Math.max(100, opts?.maxDocsScanned ?? 2000), 6000);
  const norm = raw.toLowerCase();
  const { rows, error } = await chatSearchMessagesForMeRpc({
    meAppUserId: me,
    roomKind: 'social_dm',
    roomId: rid,
    needle: raw,
    maxScan: maxDocs,
    matchLimit: 200,
  });
  if (error) return [];
  const mapped = rows.map(mapChatDeltaRowToSocialMessage);
  const filtered = mapped.filter((m) => (m.text ?? '').trim().toLowerCase().includes(norm));
  filtered.sort((a, b) => {
    const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return filtered;
}

export function subscribeSocialChatLatestMessage(
  roomId: string,
  onLatest: (message: SocialChatMessage | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const rid = roomId.trim();
  if (!rid) {
    onLatest(null);
    return () => {};
  }
  let alive = true;
  const pull = async () => {
    const raw = (await readStoredUserId())?.trim();
    if (!alive || !raw) return;
    const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
    if (!me) return;
    try {
      const res = await chatPullTailRpc({ meAppUserId: me, roomKind: 'social_dm', roomId: rid, limit: SOCIAL_LATEST_PREVIEW_LIMIT });
      if (res.error) {
        onError?.(res.error);
        return;
      }
      const first = res.rows[0];
      onLatest(first ? mapChatDeltaRowToSocialMessage(first) : null);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };
  voidSafe(pull());
  return () => {
    alive = false;
  };
}

export function subscribeSocialChatMessages(
  roomId: string,
  onMessages: (messages: SocialChatMessage[]) => void,
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): Unsubscribe {
  const rt = normalizeChatRealtimeSubscribeCallbacks(callbacks);
  const rid = roomId.trim();
  if (!rid) {
    onMessages([]);
    return () => {};
  }
  let alive = true;
  let stopRealtime: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pull = async () => {
    const raw = (await readStoredUserId())?.trim();
    if (!alive || !raw) return;
    const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
    if (!me) return;
    try {
      const res = await chatPullTailRpc({ meAppUserId: me, roomKind: 'social_dm', roomId: rid, limit: SOCIAL_CHAT_PAGE_SIZE });
      if (res.error) {
        rt.onGiveUp?.(res.error);
        return;
      }
      const desc = res.rows.map(mapChatDeltaRowToSocialMessage);
      const chrono = [...desc].reverse();
      onMessages(chrono);
    } catch (e) {
      rt.onGiveUp?.(e instanceof Error ? e.message : String(e));
    }
  };
  voidSafe(
    (async () => {
      await pull();
      if (!alive) return;
      const raw = (await readStoredUserId())?.trim();
      if (!raw) return;
      const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
      if (!me) return;
      let canonical = rid;
      try {
        const peek = await chatPullTailRpc({ meAppUserId: me, roomKind: 'social_dm', roomId: rid, limit: 1 });
        if (peek.canonical_room_id?.trim()) canonical = peek.canonical_room_id.trim();
      } catch {
        /* noop */
      }
      const filter = `room_id=eq.${canonical}`;
      stopRealtime = startPostgresRealtimeSubscription({
        channelBaseName: 'social-chat-messages',
        uniqueKey: canonical,
        configure: (ch) => {
          ch.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'chat_messages', filter },
            () => {
              if (!alive) return;
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                debounceTimer = null;
                voidSafe(pull());
              }, 200);
            },
          );
        },
        shouldStop: () => !alive,
        logLabel: 'social-chat-messages',
        onTransientFailure: () => voidSafe(pull()),
        ...postgresRealtimeHandlersFromChatCallbacks(rt, '채팅을 불러오지 못했어요.'),
      });
    })(),
  );
  return () => {
    alive = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    stopRealtime?.();
  };
}

export type SocialChatLiveTailEvent = {
  tailDesc: SocialChatMessage[];
  /** 호환 필드 — 항상 null(Supabase tail에는 문서 스냅샷 없음) */
  tailOldestDoc: null;
  evictedFromTailDesc: SocialChatMessage[];
};

function subscribeSocialChatLiveTailSupabase(
  roomId: string,
  onEvent: (event: SocialChatLiveTailEvent) => void,
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): Unsubscribe {
  const rt = normalizeChatRealtimeSubscribeCallbacks(callbacks);
  const rid = typeof roomId === 'string' ? roomId.trim() : String(roomId ?? '').trim();
  if (!rid) {
    onEvent({ tailDesc: [], tailOldestDoc: null, evictedFromTailDesc: [] });
    return () => {};
  }
  let alive = true;
  let stopRealtime: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let prevTail: SocialChatMessage[] = [];

  const emitFromRpcRows = (rows: ChatDeltaRow[]) => {
    if (!alive) return;
    const curr = rows.map(mapChatDeltaRowToSocialMessage);
    const currIds = new Set(curr.map((m) => m.id));
    const evictedFromTailDesc = prevTail.filter((m) => !currIds.has(m.id));
    prevTail = curr;
    onEvent({ tailDesc: curr, tailOldestDoc: null, evictedFromTailDesc });
  };

  const pullAndEmit = async () => {
    const me = (await readStoredUserId())?.trim();
    if (!alive || !me) return;
    try {
      const res = await chatPullTailRpc({
        meAppUserId: me,
        roomKind: 'social_dm',
        roomId: rid,
        limit: SOCIAL_CHAT_PAGE_SIZE,
      });
      if (res.error) {
        rt.onGiveUp?.(res.error);
        return;
      }
      emitFromRpcRows(res.rows);
    } catch (e) {
      rt.onGiveUp?.(e instanceof Error ? e.message : String(e));
    }
  };

  voidSafe(
    (async () => {
      await pullAndEmit();
      if (!alive) return;
      const me = (await readStoredUserId())?.trim();
      if (!me) return;
      let canonical = rid;
      try {
        const peek = await chatPullTailRpc({ meAppUserId: me, roomKind: 'social_dm', roomId: rid, limit: 1 });
        if (peek.canonical_room_id?.trim()) canonical = peek.canonical_room_id.trim();
      } catch {
        /* noop */
      }
      const filter = `room_id=eq.${canonical}`;
      stopRealtime = startPostgresRealtimeSubscription({
        channelBaseName: 'social-chat-live',
        uniqueKey: canonical,
        configure: (ch) => {
          ch.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'chat_messages', filter },
            () => {
              if (!alive) return;
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                debounceTimer = null;
                voidSafe(pullAndEmit());
              }, 150);
            },
          );
        },
        shouldStop: () => !alive,
        logLabel: 'social-chat-live',
        onTransientFailure: () => voidSafe(pullAndEmit()),
        ...postgresRealtimeHandlersFromChatCallbacks(rt, '채팅 실시간 연결에 실패했어요.'),
      });
    })(),
  );

  return () => {
    alive = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    stopRealtime?.();
  };
}

export function subscribeSocialChatLiveTail(
  roomId: string,
  onEvent: (event: SocialChatLiveTailEvent) => void,
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): Unsubscribe {
  return subscribeSocialChatLiveTailSupabase(roomId, onEvent, callbacks);
}

export type { ChatRealtimeSubscribeCallbacks } from '@/src/lib/chat-realtime-subscribe-callbacks';

export type SocialChatFetchedMessagesPage = {
  messages: SocialChatMessage[];
  oldestMessageId: string | null;
  hasMore: boolean;
};

export async function fetchSocialChatLatestPage(roomId: string): Promise<SocialChatFetchedMessagesPage> {
  const rid = roomId.trim();
  if (!rid) return { messages: [], oldestMessageId: null, hasMore: false };
  const me = (await readStoredUserId())?.trim();
  if (!me) return { messages: [], oldestMessageId: null, hasMore: false };
  try {
    const res = await chatPullTailRpc({ meAppUserId: me, roomKind: 'social_dm', roomId: rid, limit: SOCIAL_CHAT_PAGE_SIZE });
    if (res.error) {
      if (__DEV__) console.warn('[social-chat] chat_pull_tail', res.error);
      return { messages: [], oldestMessageId: null, hasMore: false };
    }
    const desc = res.rows.map(mapChatDeltaRowToSocialMessage);
    const messages = [...desc].reverse();
    const oldestMessageId = messages.length ? messages[0]!.id : null;
    return { messages, oldestMessageId, hasMore: res.has_more };
  } catch (e) {
    if (__DEV__) console.warn('[social-chat] fetchSocialChatLatestPage', e);
    return { messages: [], oldestMessageId: null, hasMore: false };
  }
}

export async function fetchSocialChatOlderPageAfterMessageId(
  roomId: string,
  afterMessageId: string,
  pageSize: number = SOCIAL_CHAT_PAGE_SIZE,
): Promise<SocialChatFetchedMessagesPage> {
  const rid = roomId.trim();
  const aid = afterMessageId.trim();
  if (!rid || !aid) return { messages: [], oldestMessageId: null, hasMore: false };
  const me = (await readStoredUserId())?.trim();
  if (!me) return { messages: [], oldestMessageId: null, hasMore: false };
  try {
    const { data: anchorRow, error: anchorErr } = await supabase.from('chat_messages').select('seq').eq('id', aid).maybeSingle();
    if (anchorErr || !anchorRow) return { messages: [], oldestMessageId: null, hasMore: false };
    const seqRaw = (anchorRow as { seq?: unknown }).seq;
    const anchorSeq = typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? seqRaw : Number(seqRaw);
    if (!Number.isFinite(anchorSeq) || anchorSeq <= 0) {
      return { messages: [], oldestMessageId: null, hasMore: false };
    }
    const res = await chatPullHistoryBeforeSeqRpc({
      meAppUserId: me,
      roomKind: 'social_dm',
      roomId: rid,
      beforeSeq: Math.floor(anchorSeq),
      limit: pageSize,
    });
    if (res.error) {
      if (__DEV__) console.warn('[social-chat] chat_pull_history_before_seq', res.error);
      return { messages: [], oldestMessageId: null, hasMore: false };
    }
    const desc = res.rows.map(mapChatDeltaRowToSocialMessage);
    const messages = [...desc].reverse();
    const oldestMessageId = messages.length ? messages[0]!.id : null;
    return { messages, oldestMessageId, hasMore: res.has_more };
  } catch (e) {
    if (__DEV__) console.warn('[social-chat] fetchSocialChatOlderPageAfterMessageId', e);
    return { messages: [], oldestMessageId: null, hasMore: false };
  }
}

const PREFETCH_OLDER_SOCIAL_DEFAULT_PAGE = 100;
const PREFETCH_OLDER_SOCIAL_MAX_PAGES = 200;

export type SocialChatOlderPrefetchUntilTargetResult = {
  newPages: SocialChatFetchedMessagesPage[];
  found: boolean;
};

export async function fetchOlderSocialChatPagesUntilTargetMessageId(
  roomId: string,
  anchorOldestMessageId: string,
  targetMessageId: string,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<SocialChatOlderPrefetchUntilTargetResult> {
  const rid = roomId.trim();
  const anchor = anchorOldestMessageId.trim();
  const tid = targetMessageId.trim();
  if (!rid || !anchor || !tid) return { newPages: [], found: false };

  const pageSize = Math.min(
    Math.max(opts?.pageSize ?? PREFETCH_OLDER_SOCIAL_DEFAULT_PAGE, SOCIAL_CHAT_PAGE_SIZE),
    200,
  );
  const maxPages = Math.min(Math.max(opts?.maxPages ?? PREFETCH_OLDER_SOCIAL_MAX_PAGES, 1), 400);

  const newPages: SocialChatFetchedMessagesPage[] = [];
  let cursor = anchor;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchSocialChatOlderPageAfterMessageId(rid, cursor, pageSize);
    if (!page.messages.length) return { newPages, found: false };
    newPages.push(page);
    if (page.messages.some((m) => m.id === tid)) return { newPages, found: true };
    if (!page.hasMore || !page.oldestMessageId?.trim()) return { newPages, found: false };
    cursor = page.oldestMessageId.trim();
  }
  return { newPages, found: false };
}

export async function fetchSocialChatReadPointersForUser(
  roomId: string,
  myAppUserId: string,
): Promise<{ readId: string | null; readAt: unknown | null }> {
  const rid = roomId.trim();
  const raw = String(myAppUserId ?? '').trim();
  if (!rid || !raw) return { readId: null, readAt: null };
  const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
  if (!me) return { readId: null, readAt: null };
  try {
    const s = await chatSocialRoomSnapshotForMeRpc({ meAppUserId: me, roomId: rid });
    if (s.error) return { readId: null, readAt: null };
    const readId = s.read_last_message_id?.trim() ? s.read_last_message_id.trim() : null;
    const readAt = socialSnapshotIsoToTimestamp(s.updated_at ?? null) ?? null;
    return { readId, readAt };
  } catch {
    return { readId: null, readAt: null };
  }
}

export async function fetchSocialChatUnreadCount(
  roomId: string,
  myAppUserId: string,
  myLastReadMessageId: string | null | undefined,
  myLastReadAt: unknown | null | undefined,
  opts?: { maxDocsScanned?: number },
): Promise<number> {
  const rid = roomId.trim();
  const raw = String(myAppUserId ?? '').trim();
  if (!rid || !raw) return 0;
  void myLastReadMessageId;
  void myLastReadAt;
  void opts;
  const me = (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
  if (!me) return 0;
  try {
    const s = await chatSocialRoomSnapshotForMeRpc({ meAppUserId: me, roomId: rid });
    if (s.error) return 0;
    const n = typeof s.unread_count === 'number' && Number.isFinite(s.unread_count) ? s.unread_count : 0;
    return Math.min(Math.max(0, n), SOCIAL_CHAT_UNREAD_LIST_CAP);
  } catch {
    return 0;
  }
}

async function fetchAllSocialRoomsForUser(me: string): Promise<SocialChatRoomSummary[]> {
  const blocked = await fetchBlockedPeerIds(me).catch(() => new Set<string>());
  const seen = new Set<string>();
  const out: SocialChatRoomSummary[] = [];
  for (let page = 0; page < 200; page += 1) {
    const { rooms, hasMore } = await fetchChatRoomsListPageFromSupabase(me, page);
    for (const r of rooms) {
      if (blocked.has(r.peerAppUserId.trim())) continue;
      if (seen.has(r.roomId)) continue;
      seen.add(r.roomId);
      out.push(r);
    }
    if (!hasMore) break;
  }
  return out;
}

export function subscribeMySocialChatRooms(
  myAppUserId: string,
  onRooms: (rooms: SocialChatRoomSummary[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const me = (normalizePhoneUserId(myAppUserId) ?? myAppUserId).trim();
  if (!me) {
    onRooms([]);
    return () => {};
  }
  let cancelled = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (cancelled) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      voidSafe(pull());
    }, 250);
  };

  const pull = async () => {
    if (cancelled) return;
    try {
      const rooms = await fetchAllSocialRoomsForUser(me);
      if (!cancelled) onRooms(rooms);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };

  voidSafe(pull());
  const unsubRt = subscribeChatListRefresh(() => {
    schedule();
  });

  return () => {
    cancelled = true;
    if (debounce) clearTimeout(debounce);
    unsubRt();
  };
}

export async function sendSocialChatTextMessage(
  roomId: string,
  senderAppUserId: string,
  rawText: string,
  replyTo?: MeetingChatMessage['replyTo'] | null,
): Promise<void> {
  const rid = roomId.trim();
  const uid = senderAppUserId.trim();
  if (!rid) throw new Error('채팅방 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  const text = rawText.trim().slice(0, 4000);
  if (!text) throw new Error('메시지를 입력해 주세요.');
  const senderId = normalizePhoneUserId(uid) ?? uid;
  const senderPk = normalizeParticipantId(senderId) || senderId;
  const peerPk = parsePeerFromSocialRoomId(rid, senderPk);
  const [senderProfile, blockedByMe] = await Promise.all([
    getUserProfile(senderId).catch(() => null),
    peerPk ? isPeerBlockedByMe(senderPk, peerPk).catch(() => false) : Promise.resolve(false),
  ]);
  if (blockedByMe) {
    throw new Error('차단한 사용자에게는 메시지를 보낼 수 없어요.');
  }
  if (peerPk) {
    await ensureSocialChatRoomDoc(rid, senderId, peerPk);
  }
  const meAppUserId = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  const linkPreview = await buildLinkPreviewForChatText(text);
  const clientMutationId = newChatClientMutationId();
  const replyToRpc =
    replyTo && replyTo.messageId?.trim()
      ? {
          messageId: replyTo.messageId.trim(),
          senderId: replyTo.senderId ?? null,
          kind: replyTo.kind ?? 'text',
          imageUrl: replyTo.imageUrl ?? null,
          text: String(replyTo.text ?? '').trim().slice(0, 280),
        }
      : null;
  const res = await chatSendMessageRpc({
    meAppUserId,
    roomKind: 'social_dm',
    roomId: rid,
    clientMutationId,
    kind: 'text',
    bodyText: text,
    replyTo: replyToRpc,
    linkPreview: linkPreview ? (linkPreview as unknown as Record<string, unknown>) : null,
  });
  if (!res.ok && !res.duplicate) {
    throw new Error(res.error?.trim() || '메시지를 보내지 못했습니다.');
  }
  const messageId = (res.id?.trim() || clientMutationId).trim();
}

const CHAT_IMAGE_MAX_WIDTH_LOW = 1280;
const CHAT_IMAGE_MAX_WIDTH_HIGH = 1920;
const CHAT_IMAGE_JPEG_QUALITY_LOW = 0.68;
const CHAT_IMAGE_JPEG_QUALITY_HIGH = 0.86;

export type SendSocialChatImageExtras = {
  caption?: string;
  naturalWidth?: number;
  imageAlbumBatchId?: string;
  suppressRemoteNotify?: boolean;
};

async function notifySocialDmImagePreview(
  _rid: string,
  _senderId: string,
  _preview: string,
  _lastMessageId?: string,
): Promise<void> {
  /** FCM은 DB Webhook → `chat-user-notifications-broadcast` → `fcm-push-send` 경로가 담당 */
}

function supabasePublicObjectPathFromUrl(url: string, bucket: string): string {
  const u = (url ?? '').trim();
  const b = bucket.trim();
  if (!u || !b) return '';
  try {
    const parsed = new URL(u);
    const marker = `/storage/v1/object/public/${encodeURIComponent(b)}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx < 0) return '';
    const rest = parsed.pathname.slice(idx + marker.length);
    return decodeURIComponent(rest).replace(/^\/+/, '');
  } catch {
    return '';
  }
}

export async function sendSocialChatImageMessage(
  roomId: string,
  senderAppUserId: string,
  localImageUri: string,
  extras?: SendSocialChatImageExtras,
): Promise<void> {
  const rid = roomId.trim();
  const uid = senderAppUserId.trim();
  const uri = typeof localImageUri === 'string' ? localImageUri.trim() : '';
  if (!rid) throw new Error('채팅방 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!uri) throw new Error('이미지를 선택해 주세요.');

  const senderId = normalizePhoneUserId(uid) ?? uid;
  const senderPk = normalizeParticipantId(senderId) || senderId;
  const peerPkImg = parsePeerFromSocialRoomId(rid, senderPk);
  if (peerPkImg) {
    await ensureSocialChatRoomDoc(rid, senderId, peerPkImg);
  }
  const cap = (extras?.caption ?? '').trim().slice(0, 500);
  const naturalWidth = extras?.naturalWidth;
  const albumId = typeof extras?.imageAlbumBatchId === 'string' ? extras.imageAlbumBatchId.trim() : '';
  const suppressRemote = extras?.suppressRemoteNotify === true;

  const quality = await getSocialChatImageUploadQuality(rid).catch(() => 'low' as const);
  const maxWidth = quality === 'high' ? CHAT_IMAGE_MAX_WIDTH_HIGH : CHAT_IMAGE_MAX_WIDTH_LOW;
  const compress = quality === 'high' ? CHAT_IMAGE_JPEG_QUALITY_HIGH : CHAT_IMAGE_JPEG_QUALITY_LOW;

  const actions: ImageManipulator.Action[] = [];
  if (typeof naturalWidth === 'number' && naturalWidth > maxWidth) {
    actions.push({ resize: { width: maxWidth } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
  if (!base64?.length) {
    throw new Error('압축된 이미지를 읽지 못했습니다. 다시 선택해 주세요.');
  }

  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `dm/${rid}/chatImages/${Date.now()}_${rand}.jpg`;
  const imageUrl = await uploadJpegBase64ToSupabasePublicBucket(
    SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
    objectPath,
    base64,
  );

  const meAppUserId = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  const clientMutationId = newChatClientMutationId();
  const res = await chatSendMessageRpc({
    meAppUserId,
    roomKind: 'social_dm',
    roomId: rid,
    clientMutationId,
    kind: 'image',
    bodyText: cap || null,
    imageUrl,
    imageAlbumBatchId: albumId || null,
  });
  if (!res.ok && !res.duplicate) {
    throw new Error(res.error?.trim() || '사진을 보내지 못했습니다.');
  }
  const messageId = (res.id?.trim() || clientMutationId).trim();

  if (!suppressRemote) {
    const pv = cap ? `사진 · ${cap}` : '사진';
    void notifySocialDmImagePreview(rid, senderId, pv, messageId);
  }
}

export type SendSocialChatImageMessagesBatchExtras = {
  caption?: string;
  naturalWidths?: (number | undefined)[];
};

export async function sendSocialChatImageMessagesBatch(
  roomId: string,
  senderAppUserId: string,
  localImageUris: string[],
  extras?: SendSocialChatImageMessagesBatchExtras,
): Promise<void> {
  const rid = roomId.trim();
  const uid = senderAppUserId.trim();
  const uris = localImageUris.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean);
  if (!rid || !uid || uris.length === 0) return;
  const batchId =
    uris.length > 1
      ? `alb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      : '';
  const isMulti = uris.length > 1;
  const senderId = normalizePhoneUserId(uid) ?? uid;
  for (let i = 0; i < uris.length; i++) {
    const nw = extras?.naturalWidths?.[i];
    await sendSocialChatImageMessage(rid, uid, uris[i]!, {
      caption: i === 0 ? extras?.caption : undefined,
      naturalWidth: typeof nw === 'number' && nw > 0 ? nw : undefined,
      imageAlbumBatchId: batchId || undefined,
      suppressRemoteNotify: isMulti,
    });
  }
  if (isMulti) {
    const cap0 = (extras?.caption ?? '').trim();
    const preview = cap0 ? `사진 ${uris.length}장 · ${cap0.slice(0, 80)}` : `사진 ${uris.length}장`;
    void notifySocialDmImagePreview(rid, senderId, preview);
  }
}

export async function deleteSocialChatImageMessageBestEffort(
  roomId: string,
  messageId: string,
  imageUrl: string,
): Promise<void> {
  const rid = typeof roomId === 'string' ? roomId.trim() : String(roomId ?? '').trim();
  const msgId = typeof messageId === 'string' ? messageId.trim() : String(messageId ?? '').trim();
  const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!rid) throw new Error('채팅방 정보가 없습니다.');
  if (!msgId) throw new Error('메시지 정보가 없습니다.');

  const me = (await readStoredUserId())?.trim();
  if (!me) throw new Error('로그인이 필요합니다.');
  const res = await chatSoftDeleteMessageRpc({
    meAppUserId: me,
    roomKind: 'social_dm',
    roomId: rid,
    messageId: msgId,
    mode: 'image',
  });
  if (!res.ok) {
    const err = res.error?.trim();
    if (err) throw new Error(err);
  }
  const objectPath = supabasePublicObjectPathFromUrl(url, SUPABASE_STORAGE_BUCKET_MEETING_CHAT);
  if (!objectPath) return;
  try {
    await supabase.storage.from(SUPABASE_STORAGE_BUCKET_MEETING_CHAT).remove([objectPath]);
  } catch {
    /* best-effort */
  }
}

export async function deleteSocialChatTextMessageBestEffort(roomId: string, messageId: string): Promise<void> {
  const rid = typeof roomId === 'string' ? roomId.trim() : String(roomId ?? '').trim();
  const msgId = typeof messageId === 'string' ? messageId.trim() : String(messageId ?? '').trim();
  if (!rid) throw new Error('채팅방 정보가 없습니다.');
  if (!msgId) throw new Error('메시지 정보가 없습니다.');

  const me = (await readStoredUserId())?.trim();
  if (!me) throw new Error('로그인이 필요합니다.');
  const res = await chatSoftDeleteMessageRpc({
    meAppUserId: me,
    roomKind: 'social_dm',
    roomId: rid,
    messageId: msgId,
    mode: 'text',
  });
  if (!res.ok) {
    const err = res.error?.trim();
    if (err) throw new Error(err);
  }
}
