/**
 * 모임 채팅 — Supabase(Postgres·Realtime·RPC) + 로컬(WatermelonDB) 기준.
 *
 * 채팅 이미지는 **Supabase Storage** 버킷 `meeting_chat` 에 저장합니다(`0021_meeting_chat_storage.sql`).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Timestamp, type Unsubscribe } from '@/src/lib/ginit-timestamp';
import { supabase } from '@/src/lib/supabase';
import { startPostgresRealtimeSubscription } from '@/src/lib/supabase-realtime-resilience';
import {
  SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';
import { normalizeParticipantId, readStoredUserId } from '@/src/lib/app-user-id';
import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import {
  chatReadPointerRoomIdsForRealtime,
  chatReadPointersPostgresFilter,
} from '@/src/lib/chat-bubble-read-pointers-realtime';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { applyChatReadPointerRealtimeToLocal } from '@/src/lib/chat-read-pointer-realtime-local';
import {
  pullMeetingChatReadPointersToLocal,
  scheduleDebouncedPullMeetingChatReadPointers,
} from '@/src/lib/meeting-chat-rooms-summary';
import {
  ensureSupabaseRealtimeAuthFromSession,
  getSupabaseAuthUserIdForRealtimeTopic,
} from '@/src/lib/supabase-realtime-resilience';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { isLedgerMeetingId, ledgerMeetingPutRawDoc, ledgerTryLoadMeetingDoc } from '@/src/lib/meetings-ledger';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { buildLinkPreviewForChatText } from '@/src/lib/chat-link-preview-for-send';
import {
  chatDeleteAllMeetingMessagesRpc,
  chatMarkReadRpc,
  chatMeetingSummaryForMeRpc,
  chatPullHistoryBeforeSeqRpc,
  chatPullTailRpc,
  chatSearchMessagesForMeRpc,
  chatSendMessageRpc,
  chatSoftDeleteMessageRpc,
  newChatClientMutationId,
  type ChatDeltaRow,
} from '@/src/lib/chat-supabase-delta';
import { getUserProfile } from '@/src/lib/user-profile';
import {
  normalizeChatRealtimeSubscribeCallbacks,
  postgresRealtimeHandlersFromChatCallbacks,
  type ChatRealtimeSubscribeCallbacks,
} from '@/src/lib/chat-realtime-subscribe-callbacks';
import { voidSafe } from '@/src/lib/void-safe';

export const MEETING_MESSAGES_SUBCOLLECTION = 'messages';

export type MeetingChatMessageKind = 'text' | 'system' | 'image';

/** 링크 미리보기(전송 시 Edge unfurl 결과를 Firestore에 저장). */
export type MeetingChatLinkPreview = {
  url: string;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  siteName?: string | null;
};

export type MeetingChatMessage = {
  id: string;
  senderId: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  text: string;
  kind: MeetingChatMessageKind;
  /** `kind === 'image'`일 때 다운로드 URL */
  imageUrl: string | null;
  /** 한 번에 여러 장 전송 시 같은 값으로 묶어 앨범 UI에 표시 */
  imageAlbumBatchId?: string | null;
  /** 텍스트 메시지에 URL이 있을 때 OG 미리보기 */
  linkPreview?: MeetingChatLinkPreview | null;
  /** 답장(인용) */
  replyTo?: {
    messageId: string;
    senderId: string | null;
    kind?: MeetingChatMessageKind;
    imageUrl?: string | null;
    text: string;
  } | null;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
  deletedAt?: Timestamp | null;
  /** Watermelon `server_seq` — 낙관적 전송 UI(시계) 해제에 사용 */
  serverSeq?: number | null;
  /** Supabase `client_mutation_id` — tail upsert 시 낙관적 행과 병합 */
  clientMutationId?: string | null;
};

function shallowUnknownRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return { ...(v as Record<string, unknown>) };
}

function meetingReadReceiptUserKeys(userId: string): string[] {
  const raw = String(userId ?? '').trim();
  if (!raw) return [];
  const phone = (normalizePhoneUserId(raw) ?? '').trim();
  const pk = (normalizeParticipantId(raw) ?? '').trim();
  const out: string[] = [];
  const push = (v: string) => {
    const s = v.trim();
    if (!s || out.includes(s)) return;
    out.push(s);
  };
  push(phone || pk || raw);
  if (phone) push(phone);
  if (pk) push(pk);
  push(raw);
  return out;
}

/**
 * 채팅 읽음 영수증(참여자별) 기록.
 * - `meetings/{meetingId}.chatReadAtBy.{userId}`: serverTimestamp (Firestore) / ISO 문자열(Ledger)
 * - `meetings/{meetingId}.chatReadMessageIdBy.{userId}`: 마지막으로 본 메시지 id
 *
 * Ledger 모임은 `ledger_meeting_put_doc`로 `meetings` 원장 JSON에 병합해야 말풍선 안읽음이 갱신됩니다.
 * 동시에 채팅 메시지가 Postgres(`chat_messages`)에 있으면 `chat_mark_read`로 읽음 포인터·`chat_room_participants.unread_count`도 맞춥니다.
 *
 * Supabase 경로: `opts.lastReadSeq`가 있으면 `chat_messages` 조회 없이 `chat_mark_read`만 호출합니다.
 * (로컬/낙관적 id로 `seq` 조회가 실패해 읽음이 서버에 안 남는 경우 방지)
 */
export async function writeMeetingChatReadReceipt(
  meetingId: string,
  userId: string,
  lastMessageId: string,
  opts?: { lastReadSeq?: number | null; canonicalRoomId?: string | null },
): Promise<void> {
  const mid = meetingId.trim();
  const uid = userId.trim();
  const lid = lastMessageId.trim();
  if (!mid || !uid) return;

  const me = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  if (!me) return;

  let seq: number | null = null;
  const direct = opts?.lastReadSeq;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    seq = Math.floor(direct);
  } else if (lid && !lid.startsWith('local:')) {
    let canon = String(opts?.canonicalRoomId ?? '').trim();
    if (!canon) {
      try {
        const peek = await chatPullTailRpc({ meAppUserId: me, roomKind: 'meeting', roomId: mid, limit: 1 });
        if (peek.canonical_room_id?.trim()) canon = peek.canonical_room_id.trim();
      } catch {
        /* noop */
      }
    }
    const roomIdsToTry = [...new Set([mid, canon].filter(Boolean))];
    for (const rid of roomIdsToTry) {
      const { data: row, error } = await supabase
        .from('chat_messages')
        .select('seq')
        .eq('id', lid)
        .eq('room_kind', 'meeting')
        .eq('room_id', rid)
        .maybeSingle();
      if (error) {
        ginitNotifyDbg('BubbleRead', 'mark_read_seq_lookup_error', { meetingId: mid, roomId: rid, message: error.message });
        continue;
      }
      if (!row) continue;
      const seqRaw = (row as { seq?: unknown }).seq;
      const parsed = typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? seqRaw : Number(seqRaw);
      if (Number.isFinite(parsed) && parsed > 0) {
        seq = Math.floor(parsed);
        break;
      }
    }
    if (seq == null) {
      ginitNotifyDbg('BubbleRead', 'mark_read_seq_lookup_miss', { meetingId: mid, msgSuffix: lid.slice(-8) });
    }
  }

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    if (!lid) return;
    const cur = await ledgerTryLoadMeetingDoc(mid);
    if (!cur) return;
    const prevAt = shallowUnknownRecord(cur.chatReadAtBy);
    const prevMid = shallowUnknownRecord(cur.chatReadMessageIdBy);
    const next: Record<string, unknown> = {
      ...cur,
      chatReadAtBy: { ...prevAt, [uid]: new Date().toISOString() },
      chatReadMessageIdBy: { ...prevMid, [uid]: lid },
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(next) as Record<string, unknown>);
    if (seq != null && seq > 0) {
      const seqKey = meetingMarkReadSeqKey(me, mid);
      const prevSeq = lastMeetingMarkReadSeqByKey.get(seqKey) ?? 0;
      if (seq <= prevSeq) {
        return;
      }
      const res = await chatMarkReadRpc({ meAppUserId: me, roomKind: 'meeting', roomId: mid, lastReadSeq: seq });
      if (!res.ok) {
        ginitNotifyDbg('BubbleRead', 'chat_mark_read_fail', { meetingId: mid, error: res.error ?? 'unknown' });
      } else {
        lastMeetingMarkReadSeqByKey.set(seqKey, seq);
        ginitNotifyDbg('BubbleRead', 'chat_mark_read_ok', { meetingId: mid, lastReadSeq: seq });
        scheduleDebouncedPullMeetingChatReadPointers({
          meetingId: mid,
          myAppUserId: me,
          canonicalRoomId: opts?.canonicalRoomId ?? null,
        });
      }
    }
    return;
  }

  if (seq == null || seq <= 0) {
    if (lid && !lid.startsWith('local:')) {
      ginitNotifyDbg('BubbleRead', 'mark_read_invalid_seq', { meetingId: mid, msgSuffix: lid.slice(-8) });
    }
    return;
  }
  const seqKey = meetingMarkReadSeqKey(me, mid);
  const prevSeq = lastMeetingMarkReadSeqByKey.get(seqKey) ?? 0;
  if (seq <= prevSeq) {
    return;
  }
  const res = await chatMarkReadRpc({ meAppUserId: me, roomKind: 'meeting', roomId: mid, lastReadSeq: seq });
  if (!res.ok) {
    ginitNotifyDbg('BubbleRead', 'chat_mark_read_fail', { meetingId: mid, error: res.error ?? 'unknown' });
    if (__DEV__) console.warn('[meeting-chat] chat_mark_read', res.error);
    return;
  }
  lastMeetingMarkReadSeqByKey.set(seqKey, seq);
  ginitNotifyDbg('BubbleRead', 'chat_mark_read_ok', { meetingId: mid, lastReadSeq: seq });
  scheduleDebouncedPullMeetingChatReadPointers({
    meetingId: mid,
    myAppUserId: me,
    canonicalRoomId: opts?.canonicalRoomId ?? null,
  });
}

/** 실시간 tail + 과거 페이지에서 공통으로 사용하는 페이지 크기 */
export const MEETING_CHAT_PAGE_SIZE = 20;

const lastMeetingMarkReadSeqByKey = new Map<string, number>();

function meetingMarkReadSeqKey(meAppUserId: string, meetingId: string): string {
  return `${meAppUserId.trim()}\0${meetingId.trim()}`;
}

const LATEST_PREVIEW_LIMIT = 1;

function isoStringToMeetingTimestamp(iso: string | null | undefined): Timestamp {
  const t = typeof iso === 'string' && iso.trim() ? Date.parse(iso.trim()) : NaN;
  return Timestamp.fromMillis(Number.isFinite(t) ? t : Date.now());
}

function mapChatDeltaRowToMeetingChatMessage(row: ChatDeltaRow): MeetingChatMessage {
  const id = String(row.id ?? '').trim();
  const createdAt = isoStringToMeetingTimestamp(row.created_at);
  const updatedAt = row.updated_at ? isoStringToMeetingTimestamp(row.updated_at) : createdAt;
  const deletedAt = row.deleted_at ? isoStringToMeetingTimestamp(row.deleted_at) : null;
  const kindRaw = row.kind;
  const kind: MeetingChatMessageKind =
    kindRaw === 'system' ? 'system' : kindRaw === 'image' ? 'image' : 'text';
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
  let replyTo: MeetingChatMessage['replyTo'] = null;
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
  let linkPreview: MeetingChatLinkPreview | null = null;
  const lpRaw = row.link_preview;
  if (lpRaw && typeof lpRaw === 'object' && !Array.isArray(lpRaw)) {
    const o = lpRaw as Record<string, unknown>;
    const u = typeof o.url === 'string' ? o.url.trim() : '';
    if (u) {
      linkPreview = {
        url: u,
        title: typeof o.title === 'string' ? o.title : null,
        description: typeof o.description === 'string' ? o.description : null,
        imageUrl: typeof o.imageUrl === 'string' ? o.imageUrl : null,
        siteName: typeof o.siteName === 'string' ? o.siteName : null,
      };
    }
  }
  const seqRaw = row.seq;
  const serverSeq =
    typeof seqRaw === 'number' && Number.isFinite(seqRaw) && seqRaw > 0
      ? Math.floor(seqRaw)
      : Number.isFinite(Number(seqRaw)) && Number(seqRaw) > 0
        ? Math.floor(Number(seqRaw))
        : undefined;
  const clientMutationId =
    typeof row.client_mutation_id === 'string' && row.client_mutation_id.trim() ? row.client_mutation_id.trim() : null;
  return {
    id,
    serverSeq,
    clientMutationId,
    senderId,
    senderName: null,
    senderAvatarUrl: null,
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

/** 대화 검색·미리보기용 텍스트(소문자 비교는 호출 측에서) */
export function meetingChatMessageSearchHaystack(m: MeetingChatMessage): string {
  if (m.kind === 'system') return (m.text ?? '').trim();
  if (m.kind === 'image') {
    const cap = (m.text ?? '').trim();
    return cap ? `사진 ${cap}` : '사진';
  }
  const base = (m.text ?? '').trim();
  const lp = m.linkPreview;
  if (!lp?.url) return base;
  const extra = [lp.title, lp.description, lp.siteName].filter((x) => typeof x === 'string' && x.trim()).join(' ');
  return extra ? `${base} ${extra}` : base;
}

const CHAT_IMAGES_PAGE_SIZE = 60;
const CHAT_IMAGES_SCAN_PAGE = 220;

/** Supabase 사진 탭 페이징 커서(Firestore `DocumentSnapshot` 대체). */
export type MeetingChatImagesSbCursor = {
  __tag: 'sb_meeting_chat_images';
  canonicalRoomId: string;
  /** 다음 페이지: `seq < beforeSeqExclusive` */
  beforeSeqExclusive: number;
};

export type MeetingChatImagesPageCursor = MeetingChatImagesSbCursor;

function isMeetingChatImagesSbCursor(v: MeetingChatImagesSbCursor | null): v is MeetingChatImagesSbCursor {
  return (
    v != null &&
    typeof v.__tag === 'string' &&
    v.__tag === 'sb_meeting_chat_images'
  );
}

/**
 * 채팅방 "사진" 탭용 — `kind === 'image'` 메시지 페이징.
 * 최신(최근)부터 내려받아 UI에서는 그대로 그리드에 추가합니다.
 */
export async function fetchMeetingChatImagesPage(
  meetingId: string,
  cursor: MeetingChatImagesSbCursor | null,
): Promise<{ images: MeetingChatMessage[]; nextCursor: MeetingChatImagesSbCursor | null; hasMore: boolean }> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) return { images: [], nextCursor: null, hasMore: false };

  const me = (await readStoredUserId())?.trim();
  if (!me) return { images: [], nextCursor: null, hasMore: false };
  let canonical = mid;
  try {
    const sum = await chatMeetingSummaryForMeRpc({ meAppUserId: me, meetingId: mid });
    if (sum.canonical_room_id?.trim()) canonical = sum.canonical_room_id.trim();
  } catch {
    /* noop */
  }
  const beforeSeq = cursor?.beforeSeqExclusive ?? null;
  const roomForQuery = cursor?.canonicalRoomId ?? canonical;
  let q = supabase
    .from('chat_messages')
    .select(
      'id, room_kind, room_id, seq, sender_app_user_id, kind, body_text, image_url, image_album_batch_id, reply_to, link_preview, client_mutation_id, created_at, updated_at, deleted_at',
    )
    .eq('room_kind', 'meeting')
    .eq('room_id', roomForQuery)
    .eq('kind', 'image')
    .is('deleted_at', null)
    .not('image_url', 'is', null)
    .order('seq', { ascending: false })
    .limit(CHAT_IMAGES_SCAN_PAGE);
  if (beforeSeq != null && Number.isFinite(beforeSeq)) {
    q = q.lt('seq', beforeSeq);
  }
  const { data: rowsRaw, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (rowsRaw ?? []) as ChatDeltaRow[];
  const withUrl = rows.filter((r) => typeof r.image_url === 'string' && r.image_url.trim());
  const images = withUrl.slice(0, CHAT_IMAGES_PAGE_SIZE).map(mapChatDeltaRowToMeetingChatMessage);
  const batchLen = withUrl.length;
  const hasMore = batchLen >= CHAT_IMAGES_SCAN_PAGE;
  const minSeq = batchLen ? Number(withUrl[batchLen - 1]!.seq) : null;
  const nextCursor: MeetingChatImagesSbCursor | null =
    hasMore && minSeq != null && Number.isFinite(minSeq)
      ? { __tag: 'sb_meeting_chat_images', canonicalRoomId: roomForQuery, beforeSeqExclusive: minSeq }
      : null;
  return { images, nextCursor, hasMore };
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

/**
 * 채팅 이미지 1건 삭제(카카오톡처럼 "삭제됨" 이력 남김).
 * - Firestore 문서는 유지하고, 내용만 자리표시로 치환합니다(소프트 삭제).
 * - Storage 파일은 best-effort로 제거합니다(실패해도 무시).
 */
export async function deleteMeetingChatImageMessageBestEffort(
  meetingId: string,
  messageId: string,
  imageUrl: string,
): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const msgId = typeof messageId === 'string' ? messageId.trim() : String(messageId ?? '').trim();
  const url = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!msgId) throw new Error('메시지 정보가 없습니다.');

  const me = (await readStoredUserId())?.trim();
  if (!me) throw new Error('로그인이 필요합니다.');
  const res = await chatSoftDeleteMessageRpc({
    meAppUserId: me,
    roomKind: 'meeting',
    roomId: mid,
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

/**
 * 텍스트 메시지 1건 삭제(소프트 삭제).
 * - 문서는 유지하고, 시스템 메시지로 치환합니다.
 */
export async function deleteMeetingChatTextMessageBestEffort(meetingId: string, messageId: string): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const msgId = typeof messageId === 'string' ? messageId.trim() : String(messageId ?? '').trim();
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!msgId) throw new Error('메시지 정보가 없습니다.');

  const me = (await readStoredUserId())?.trim();
  if (!me) throw new Error('로그인이 필요합니다.');
  const res = await chatSoftDeleteMessageRpc({
    meAppUserId: me,
    roomKind: 'meeting',
    roomId: mid,
    messageId: msgId,
    mode: 'text',
  });
  if (!res.ok) {
    const err = res.error?.trim();
    if (err) throw new Error(err);
  }
}

/**
 * 모임 채팅에서 `needle`이 포함된 메시지를 과거 방향으로 페이지네이션하며 찾습니다.
 * 서버 RPC로 후보를 가져온 뒤 클라이언트에서 문자열 포함 여부를 검사합니다.
 */
export async function searchMeetingChatMessages(
  meetingId: string,
  needle: string,
  opts?: { maxDocsScanned?: number },
): Promise<MeetingChatMessage[]> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const raw = typeof needle === 'string' ? needle.trim() : '';
  if (!mid || !raw) return [];

  const me = (await readStoredUserId())?.trim();
  if (!me) return [];
  const maxDocs = Math.min(Math.max(200, opts?.maxDocsScanned ?? 2500), 8000);
  const norm = raw.toLowerCase();
  const { rows, error } = await chatSearchMessagesForMeRpc({
    meAppUserId: me,
    roomKind: 'meeting',
    roomId: mid,
    needle: raw,
    maxScan: maxDocs,
    matchLimit: 200,
  });
  if (error) return [];
  const mapped = rows.map(mapChatDeltaRowToMeetingChatMessage);
  const filtered = mapped.filter((m) => meetingChatMessageSearchHaystack(m).toLowerCase().includes(norm));
  filtered.sort((a, b) => {
    const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return filtered;
}

export type MeetingChatLiveTailEvent = {
  /** 최신순 tail, 최대 `MEETING_CHAT_PAGE_SIZE`건 */
  tail: MeetingChatMessage[];
  /** 호환 필드 — 항상 null(Supabase tail에는 문서 스냅샷 앵커 없음) */
  tailOldestDoc: null;
  /** tail 밖으로 밀려난 메시지(실시간으로 tail이 갱신될 때). UI의 과거 구간에 합치면 됩니다. */
  evictedFromTail: MeetingChatMessage[];
};

function subscribeMeetingChatLiveTailSupabase(
  meetingId: string,
  onEvent: (event: MeetingChatLiveTailEvent) => void,
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): Unsubscribe {
  const rt = normalizeChatRealtimeSubscribeCallbacks(callbacks);
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    onEvent({ tail: [], tailOldestDoc: null, evictedFromTail: [] });
    return () => {};
  }

  let alive = true;
  let stopRealtime: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let prevTail: MeetingChatMessage[] = [];

  const emitFromRpcRows = (rows: ChatDeltaRow[]) => {
    if (!alive) return;
    const curr = rows.map(mapChatDeltaRowToMeetingChatMessage);
    const currIds = new Set(curr.map((m) => m.id));
    const evictedFromTail = prevTail.filter((m) => !currIds.has(m.id));
    prevTail = curr;
    onEvent({ tail: curr, tailOldestDoc: null, evictedFromTail });
  };

  const pullAndEmit = async () => {
    const me = (await readStoredUserId())?.trim();
    if (!alive || !me) return;
    try {
      const res = await chatPullTailRpc({
        meAppUserId: me,
        roomKind: 'meeting',
        roomId: mid,
        limit: MEETING_CHAT_PAGE_SIZE,
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
      let canonical = mid;
      try {
        const peek = await chatPullTailRpc({ meAppUserId: me, roomKind: 'meeting', roomId: mid, limit: 1 });
        if (peek.canonical_room_id?.trim()) canonical = peek.canonical_room_id.trim();
      } catch {
        /* keep mid */
      }
      const filter = `room_id=eq.${canonical}`;
      const readRoomIds = chatReadPointerRoomIdsForRealtime(mid, canonical);

      const scheduleReadPointersPull = () => {
        if (!alive || !me) return;
        scheduleDebouncedPullMeetingChatReadPointers({
          meetingId: mid,
          myAppUserId: me,
          canonicalRoomId: canonical !== mid ? canonical : null,
        });
      };

      const onMeetingReadPointersChange = (payload: {
        new?: Record<string, unknown>;
        old?: Record<string, unknown>;
      }) => {
        if (!alive) return;
        ginitNotifyDbg('BubbleRead', 'read_pointers_postgres_changes', { roomKind: 'meeting', roomIds: readRoomIds });
        void applyChatReadPointerRealtimeToLocal({
          roomKind: 'meeting',
          localRoomIds: readRoomIds,
          payload,
        })
          .catch(() => {})
          .finally(() => {
            scheduleReadPointersPull();
          });
      };

      voidSafe(pullMeetingChatReadPointersToLocal({ meetingId: mid, myAppUserId: me, canonicalRoomId: canonical !== mid ? canonical : null }));

      await ensureSupabaseRealtimeAuthFromSession();
      const authUserIdForTopic = await getSupabaseAuthUserIdForRealtimeTopic();
      const liveChannelUniqueKey = authUserIdForTopic ? `${canonical}:${authUserIdForTopic}` : canonical;

      ginitNotifyDbg('BubbleRead', 'subscribe_meeting_live_channel', { meetingId: mid, canonical, readRoomIds });
      stopRealtime = startPostgresRealtimeSubscription({
        channelBaseName: 'meeting-chat-live',
        uniqueKey: liveChannelUniqueKey,
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
                scheduleReadPointersPull();
              }, 150);
            },
          );
          for (const readRid of readRoomIds) {
            const readFilter = chatReadPointersPostgresFilter('meeting', readRid);
            ch.on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'chat_read_pointers', filter: readFilter },
              onMeetingReadPointersChange,
            );
          }
        },
        shouldStop: () => !alive,
        logLabel: 'meeting-chat-live',
        onTransientFailure: () => {
          voidSafe(pullAndEmit());
          scheduleReadPointersPull();
        },
        ...postgresRealtimeHandlersFromChatCallbacks(rt, '채팅 실시간 연결에 실패했어요.'),
      });
    })(),
  );

  /**
   * 화면 이탈 시 반드시 호출: `startPostgresRealtimeSubscription`의 `stop()`이
   * `supabase.removeChannel`로 방 전용 `postgres_changes` 채널을 제거합니다.
   */
  return () => {
    alive = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    stopRealtime?.();
  };
}

/**
 * 최신 `MEETING_CHAT_PAGE_SIZE`건을 Supabase RPC + Realtime으로 구독합니다.
 * 새 메시지가 오면 tail이 갱신되고, 밀려난 항목은 `evictedFromTail`로 알려 줍니다.
 *
 * 채팅 UI는 `FlatList inverted` + tail을 앞쪽(최신)에 두는 배열을 기본으로 사용합니다.
 */
export function subscribeMeetingChatLiveTail(
  meetingId: string,
  onEvent: (event: MeetingChatLiveTailEvent) => void,
  callbacks?: ChatRealtimeSubscribeCallbacks | ((message: string) => void),
): Unsubscribe {
  return subscribeMeetingChatLiveTailSupabase(meetingId, onEvent, callbacks);
}

export type { ChatRealtimeSubscribeCallbacks } from '@/src/lib/chat-realtime-subscribe-callbacks';

export function meetingChatMessageDescComparator(a: MeetingChatMessage, b: MeetingChatMessage): number {
  const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
  const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
  if (ta !== tb) return tb - ta;
  return b.id.localeCompare(a.id);
}

/** `useInfiniteQuery` 페이지 단위 + AsyncStorage persist용(문서 스냅샷 대신 id 커서) */
export type MeetingChatFetchedMessagesPage = {
  messages: MeetingChatMessage[];
  /** 이 페이지에서 가장 과거(배열 마지막) 메시지 id — 다음 `startAfter` 앵커 */
  oldestMessageId: string | null;
  hasMore: boolean;
};

/** `subscribeMeetingChatLiveTail` 과 동일한 최신 20건을 RPC로 한 번 가져옵니다. */
export async function fetchMeetingChatLatestPage(meetingId: string): Promise<MeetingChatFetchedMessagesPage> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    return { messages: [], oldestMessageId: null, hasMore: false };
  }

  const me = (await readStoredUserId())?.trim();
  if (!me) return { messages: [], oldestMessageId: null, hasMore: false };
  try {
    const res = await chatPullTailRpc({
      meAppUserId: me,
      roomKind: 'meeting',
      roomId: mid,
      limit: MEETING_CHAT_PAGE_SIZE,
    });
    if (res.error) {
      if (__DEV__) console.warn('[meeting-chat] chat_pull_tail', res.error);
      return { messages: [], oldestMessageId: null, hasMore: false };
    }
    const messages = res.rows.map(mapChatDeltaRowToMeetingChatMessage);
    const oldestMessageId = messages.length ? messages[messages.length - 1]!.id : null;
    return { messages, oldestMessageId, hasMore: res.has_more };
  } catch (e) {
    if (__DEV__) console.warn('[meeting-chat] fetchMeetingChatLatestPage supabase', e);
    return { messages: [], oldestMessageId: null, hasMore: false };
  }
}

/**
 * `afterMessageId` **이후**(더 과거)부터 `pageSize`건.
 * Persist용 `useInfiniteQuery`에서 메시지 id로 커서를 둡니다.
 */
export async function fetchMeetingChatOlderPageAfterMessageId(
  meetingId: string,
  afterMessageId: string,
  pageSize: number = MEETING_CHAT_PAGE_SIZE,
): Promise<MeetingChatFetchedMessagesPage> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const aid = typeof afterMessageId === 'string' ? afterMessageId.trim() : String(afterMessageId ?? '').trim();
  if (!mid || !aid) {
    return { messages: [], oldestMessageId: null, hasMore: false };
  }

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
      roomKind: 'meeting',
      roomId: mid,
      beforeSeq: Math.floor(anchorSeq),
      limit: pageSize,
    });
    if (res.error) {
      if (__DEV__) console.warn('[meeting-chat] chat_pull_history_before_seq', res.error);
      return { messages: [], oldestMessageId: null, hasMore: false };
    }
    const messages = res.rows.map(mapChatDeltaRowToMeetingChatMessage);
    const oldestMessageId = messages.length ? messages[messages.length - 1]!.id : null;
    return { messages, oldestMessageId, hasMore: res.has_more };
  } catch (e) {
    if (__DEV__) console.warn('[meeting-chat] fetchMeetingChatOlderPageAfterMessageId supabase', e);
    return { messages: [], oldestMessageId: null, hasMore: false };
  }
}

const PREFETCH_OLDER_DEFAULT_PAGE = 100;
const PREFETCH_OLDER_MAX_PAGES = 200;

export type MeetingChatOlderPrefetchUntilTargetResult = {
  /** 기존 infinite 캐시의 마지막 페이지 **이후**(더 과거) 구간만 담은 페이지 배열 */
  newPages: MeetingChatFetchedMessagesPage[];
  /** `newPages` 안에 `targetMessageId`가 포함되었는지 */
  found: boolean;
};

/**
 * 검색 등으로 특정 메시지로 점프할 때, 현재 캐시보다 과거에만 있는 경우
 * `anchorOldestMessageId`(이미 로드된 구간 중 가장 과거 메시지 id) 다음부터
 * `targetMessageId`가 나올 때까지(또는 더 불러올 문서 없음) 과거 페이지를 이어 받습니다.
 * `pageSize`를 크게 잡아 왕복 횟수를 줄입니다.
 */
export async function fetchOlderMeetingChatPagesUntilTargetMessageId(
  meetingId: string,
  anchorOldestMessageId: string,
  targetMessageId: string,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<MeetingChatOlderPrefetchUntilTargetResult> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const anchor = typeof anchorOldestMessageId === 'string' ? anchorOldestMessageId.trim() : '';
  const tid = typeof targetMessageId === 'string' ? targetMessageId.trim() : '';
  if (!mid || !anchor || !tid) {
    return { newPages: [], found: false };
  }
  const pageSize = Math.min(
    Math.max(opts?.pageSize ?? PREFETCH_OLDER_DEFAULT_PAGE, MEETING_CHAT_PAGE_SIZE),
    200,
  );
  const maxPages = Math.min(Math.max(opts?.maxPages ?? PREFETCH_OLDER_MAX_PAGES, 1), 400);

  const newPages: MeetingChatFetchedMessagesPage[] = [];
  let cursor = anchor;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchMeetingChatOlderPageAfterMessageId(mid, cursor, pageSize);
    if (!page.messages.length) {
      return { newPages, found: false };
    }
    newPages.push(page);
    if (page.messages.some((m) => m.id === tid)) {
      return { newPages, found: true };
    }
    if (!page.hasMore || !page.oldestMessageId?.trim()) {
      return { newPages, found: false };
    }
    cursor = page.oldestMessageId.trim();
  }
  return { newPages, found: false };
}

/**
 * `lastVisibleOrId` 앵커 **이후**(더 과거) `pageSize`개를 한 번에 가져옵니다.
 * Firestore 문서 스냅샷 대신 `{ id }` 또는 메시지 id 문자열을 받습니다.
 */
export async function fetchMeetingChatOlderPage(
  meetingId: string,
  lastVisibleOrId: string | { id: string },
  pageSize: number = MEETING_CHAT_PAGE_SIZE,
): Promise<{ messages: MeetingChatMessage[]; lastVisible: null; hasMore: boolean }> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    return { messages: [], lastVisible: null, hasMore: false };
  }
  const anchorId =
    typeof lastVisibleOrId === 'string'
      ? lastVisibleOrId.trim()
      : String(lastVisibleOrId?.id ?? '').trim();
  if (!anchorId) {
    return { messages: [], lastVisible: null, hasMore: false };
  }
  const page = await fetchMeetingChatOlderPageAfterMessageId(mid, anchorId, pageSize);
  return { messages: page.messages, lastVisible: null, hasMore: page.hasMore };
}

/** 목록 배지용 — 표시 상한(카카오톡 등과 유사) */
export const MEETING_CHAT_UNREAD_LIST_CAP = 999;

/**
 * 읽지 않은 메시지 개수(서버 요약 RPC).
 * `readMessageId` 인자는 호환용으로 유지되며, 집계는 서버 `chat_meeting_summary_for_me`를 따릅니다.
 */
export async function fetchMeetingChatUnreadCount(meetingId: string, readMessageId: string | null | undefined): Promise<number> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) return 0;
  void readMessageId;

  const me = (await readStoredUserId())?.trim();
  if (!me) return 0;
  try {
    const s = await chatMeetingSummaryForMeRpc({ meAppUserId: me, meetingId: mid });
    const n = typeof s.unread_count === 'number' && Number.isFinite(s.unread_count) ? s.unread_count : 0;
    return Math.min(Math.max(0, n), MEETING_CHAT_UNREAD_LIST_CAP);
  } catch {
    return 0;
  }
}

/** 채팅 탭 목록용 — 해당 모임의 **가장 최근 메시지 1건**만 초기 로드합니다. 실시간 갱신은 `user_notifications:{profiles.id}` 브로드캐스트로 처리합니다. */
export function subscribeMeetingChatLatestMessage(
  meetingId: string,
  onLatest: (message: MeetingChatMessage | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    onLatest(null);
    return () => {};
  }

  let alive = true;
  const pull = async () => {
    const me = (await readStoredUserId())?.trim();
    if (!alive || !me) return;
    try {
      const res = await chatPullTailRpc({ meAppUserId: me, roomKind: 'meeting', roomId: mid, limit: LATEST_PREVIEW_LIMIT });
      if (res.error) {
        onError?.(res.error);
        return;
      }
      const first = res.rows[0];
      onLatest(first ? mapChatDeltaRowToMeetingChatMessage(first) : null);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };
  voidSafe(pull());
  return () => {
    alive = false;
  };
}

/** 모임 채팅 메시지 전체 삭제(탈퇴·모임 삭제용). */
export async function deleteAllMeetingChatMessages(meetingId: string): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) return;

  const me = (await readStoredUserId())?.trim();
  if (!me) return;
  try {
    const res = await chatDeleteAllMeetingMessagesRpc({ meAppUserId: me, meetingId: mid });
    if (!res.ok && __DEV__ && res.error) {
      console.warn('[meeting-chat] chat_delete_all_meeting_messages', res.error);
    }
  } catch (e) {
    if (__DEV__) console.warn('[meeting-chat] chat_delete_all_meeting_messages', e);
  }
}

/** 해당 사용자가 보낸 텍스트·이미지 메시지만 삭제합니다(다른 참여자 채팅은 유지). */
export async function deleteMeetingChatMessagesFromSender(meetingId: string, userId: string): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const uid = typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
  if (!mid || !uid) return;

  const sessionMe = (await readStoredUserId())?.trim();
  if (!sessionMe) return;
  const senderMe = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  if (!senderMe) return;
  let canonical = mid;
  try {
    const tail = await chatPullTailRpc({ meAppUserId: sessionMe, roomKind: 'meeting', roomId: mid, limit: 1 });
    if (tail.canonical_room_id?.trim()) canonical = tail.canonical_room_id.trim();
  } catch {
    /* noop */
  }
  const senderKeys = meetingReadReceiptUserKeys(uid);
  if (!senderKeys.length) return;
  const page = 200;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, kind')
      .eq('room_kind', 'meeting')
      .eq('room_id', canonical)
      .is('deleted_at', null)
      .in('sender_app_user_id', senderKeys)
      .order('seq', { ascending: true })
      .range(offset, offset + page - 1);
    if (error || !data?.length) break;
    for (const row of data) {
      const id = typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : String((row as { id?: unknown }).id ?? '');
      const kindRaw = (row as { kind?: unknown }).kind;
      const mode = kindRaw === 'image' ? 'image' : 'text';
      if (!id) continue;
      try {
        await chatSoftDeleteMessageRpc({
          meAppUserId: senderMe,
          roomKind: 'meeting',
          roomId: mid,
          messageId: id,
          mode,
        });
      } catch {
        /* best-effort per row */
      }
    }
    if (data.length < page) break;
    offset += page;
  }
}

/** 모임 채팅 이미지 Supabase 경로(`meetings/{id}/chatImages/…`)를 비웁니다. 실패는 무시합니다. */
export async function deleteMeetingChatImagesStorageBestEffort(meetingId: string): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) return;
  const prefix = `meetings/${mid}/chatImages`;
  const bucket = supabase.storage.from(SUPABASE_STORAGE_BUCKET_MEETING_CHAT);
  try {
    const paths: string[] = [];
    const pageSize = 200;
    let offset = 0;
    for (;;) {
      const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
      if (error || !data?.length) break;
      for (const f of data) {
        const name = typeof f.name === 'string' ? f.name.trim() : '';
        if (!name) continue;
        paths.push(`${prefix}/${name}`);
      }
      if (data.length < pageSize) break;
      offset += pageSize;
    }
    const batch = 100;
    for (let i = 0; i < paths.length; i += batch) {
      await bucket.remove(paths.slice(i, i + batch)).catch(() => {});
    }
  } catch {
    /* 목록·삭제 불가 시 생략 */
  }
}

/** 모임 채팅 INSERT 후 수신자 FCM — DB Webhook → `chat-user-notifications-broadcast` → `fcm-push-send`(data.unread_count)에서 처리 */
export function notifyMeetingChatParticipantsRemoteFireAndForget(_args: {
  meetingId: string;
  senderId: string;
  preview: string;
  lastMessageId?: string;
  senderName?: string | null;
}): void {
  if (Platform.OS === 'web') return;
}

export async function sendMeetingChatTextMessage(
  meetingId: string,
  senderPhoneUserId: string,
  rawText: string,
  replyTo?: { messageId: string; senderId: string | null; kind?: MeetingChatMessageKind; imageUrl?: string | null; text: string } | null,
): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const uid = typeof senderPhoneUserId === 'string' ? senderPhoneUserId.trim() : String(senderPhoneUserId ?? '').trim();
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  const text = rawText.trim().slice(0, 4000);
  if (!text) throw new Error('메시지를 입력해 주세요.');

  const meAppUserId = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  const senderId = normalizePhoneUserId(uid) ?? uid;
  const senderProfile = await getUserProfile(senderId).catch(() => null);
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
    roomKind: 'meeting',
    roomId: mid,
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
  notifyMeetingChatParticipantsRemoteFireAndForget({
    meetingId: mid,
    senderId,
    preview: text,
    lastMessageId: messageId,
    senderName: senderProfile?.nickname ?? senderProfile?.displayName ?? undefined,
  });
}

const CHAT_IMAGE_MAX_WIDTH = 1280;
const CHAT_IMAGE_JPEG_QUALITY = 0.68;

export type SendMeetingChatImageExtras = {
  /** 이미지 아래에 붙는 짧은 설명(선택) */
  caption?: string;
  /** 피커가 알려 주면, 가로가 이 값보다 클 때만 너비를 줄여 업스케일을 피합니다. */
  naturalWidth?: number;
  /** 여러 장을 한 앨범으로 묶을 때 동일한 문자열을 넣습니다. */
  imageAlbumBatchId?: string;
  /** true면 참가자 푸시 알림을 보내지 않습니다(다중 전송 시 마지막 장에서만 false). */
  suppressParticipantNotify?: boolean;
};

export type MeetingChatImageCommitResult = {
  messageId: string;
  imageUrl: string;
  seq?: number;
  clientMutationId: string;
};

/**
 * 로컬 이미지를 압축·업로드한 뒤 `chat_send_message`(image) RPC만 수행합니다.
 * 낙관적 로컬 행과 `client_mutation_id`를 맞추려면 `clientMutationId`를 미리 넘기세요.
 */
export async function meetingChatCommitImageFromLocalUri(args: {
  meetingId: string;
  senderPhoneUserId: string;
  localImageUri: string;
  extras?: SendMeetingChatImageExtras;
  clientMutationId?: string;
}): Promise<MeetingChatImageCommitResult> {
  const mid = typeof args.meetingId === 'string' ? args.meetingId.trim() : String(args.meetingId ?? '').trim();
  const uid = typeof args.senderPhoneUserId === 'string' ? args.senderPhoneUserId.trim() : String(args.senderPhoneUserId ?? '').trim();
  const uri = typeof args.localImageUri === 'string' ? args.localImageUri.trim() : '';
  const extras = args.extras;
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!uri) throw new Error('이미지를 선택해 주세요.');

  const cap = (extras?.caption ?? '').trim().slice(0, 500);
  const naturalWidth = extras?.naturalWidth;
  const albumId = typeof extras?.imageAlbumBatchId === 'string' ? extras.imageAlbumBatchId.trim() : '';

  const actions: ImageManipulator.Action[] = [];
  if (typeof naturalWidth === 'number' && naturalWidth > CHAT_IMAGE_MAX_WIDTH) {
    actions.push({ resize: { width: CHAT_IMAGE_MAX_WIDTH } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: CHAT_IMAGE_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
  if (!base64?.length) {
    throw new Error('압축된 이미지를 읽지 못했습니다. 다시 선택해 주세요.');
  }

  const rand = Math.random().toString(36).slice(2, 10);
  const objectPath = `meetings/${mid}/chatImages/${Date.now()}_${rand}.jpg`;
  const imageUrl = await uploadJpegBase64ToSupabasePublicBucket(
    SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
    objectPath,
    base64,
  );

  const meAppUserId = (normalizeParticipantId(uid) || normalizePhoneUserId(uid) || uid).trim();
  const clientMutationId =
    typeof args.clientMutationId === 'string' && args.clientMutationId.trim()
      ? args.clientMutationId.trim()
      : newChatClientMutationId();
  const res = await chatSendMessageRpc({
    meAppUserId,
    roomKind: 'meeting',
    roomId: mid,
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
  return {
    messageId,
    imageUrl,
    seq: typeof res.seq === 'number' ? res.seq : res.seq != null ? Number(res.seq) : undefined,
    clientMutationId,
  };
}

/**
 * 로컬 사진을 리사이즈·JPEG 압축한 뒤 Storage에 올리고, `kind: 'image'` 메시지를 추가합니다.
 */
export async function sendMeetingChatImageMessage(
  meetingId: string,
  senderPhoneUserId: string,
  localImageUri: string,
  extras?: SendMeetingChatImageExtras,
): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const uid = typeof senderPhoneUserId === 'string' ? senderPhoneUserId.trim() : String(senderPhoneUserId ?? '').trim();
  const uri = typeof localImageUri === 'string' ? localImageUri.trim() : '';
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  if (!uri) throw new Error('이미지를 선택해 주세요.');

  const senderId = normalizePhoneUserId(uid) ?? uid;
  const senderProfile = await getUserProfile(senderId).catch(() => null);
  const cap = (extras?.caption ?? '').trim().slice(0, 500);
  const suppressNotify = extras?.suppressParticipantNotify === true;

  const r = await meetingChatCommitImageFromLocalUri({ meetingId: mid, senderPhoneUserId: uid, localImageUri: uri, extras });
  if (!suppressNotify) {
    const imgPreview = cap ? `사진 · ${cap}` : '사진';
    notifyMeetingChatParticipantsRemoteFireAndForget({
      meetingId: mid,
      senderId,
      preview: imgPreview,
      lastMessageId: r.messageId,
      senderName: senderProfile?.nickname ?? senderProfile?.displayName ?? undefined,
    });
  }
}

/**
 * 여러 장을 순서대로 올리고, 2장 이상이면 동일 `imageAlbumBatchId`로 묶습니다.
 * 푸시 미리보기는 한 번만(`사진 N장` 또는 캡션이 있으면 첫 장 기준) 보냅니다.
 */
export type SendMeetingChatImageMessagesBatchExtras = {
  caption?: string;
  naturalWidths?: (number | undefined)[];
};

export async function sendMeetingChatImageMessagesBatch(
  meetingId: string,
  senderPhoneUserId: string,
  localImageUris: string[],
  extras?: SendMeetingChatImageMessagesBatchExtras,
): Promise<void> {
  const uris = localImageUris.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean);
  if (uris.length === 0) return;
  const batchId =
    uris.length > 1
      ? `alb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      : '';
  const isMulti = uris.length > 1;
  for (let i = 0; i < uris.length; i++) {
    const nw = extras?.naturalWidths?.[i];
    await sendMeetingChatImageMessage(meetingId, senderPhoneUserId, uris[i]!, {
      caption: i === 0 ? extras?.caption : undefined,
      naturalWidth: typeof nw === 'number' && nw > 0 ? nw : undefined,
      imageAlbumBatchId: batchId || undefined,
      suppressParticipantNotify: isMulti,
    });
  }
  if (isMulti) {
    const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
    const uid = typeof senderPhoneUserId === 'string' ? senderPhoneUserId.trim() : String(senderPhoneUserId ?? '').trim();
    const senderId = normalizePhoneUserId(uid) ?? uid;
    const cap0 = (extras?.caption ?? '').trim();
    const preview = cap0 ? `사진 ${uris.length}장 · ${cap0.slice(0, 80)}` : `사진 ${uris.length}장`;
    notifyMeetingChatParticipantsRemoteFireAndForget({
      meetingId: mid,
      senderId,
      preview,
    });
  }
}
