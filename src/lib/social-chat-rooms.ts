/**
 * 1:1 소셜 채팅 — Firestore `chat_rooms/{roomId}` + `messages` 서브컬렉션.
 * `isGroup: false` 로 모임 채팅(`meetings/.../messages`)과 구분합니다.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import {
  addDoc,
  collection,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type DocumentSnapshot,
  Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { Platform } from 'react-native';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { sendInAppAlarmRemotePushToUserFireAndForget } from '@/src/lib/in-app-alarm-push';
import type { MeetingChatMessage, MeetingChatMessageKind } from '@/src/lib/meeting-chat';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { getSocialChatNotifyEnabledForUser } from '@/src/lib/social-chat-notify-preference';
import { supabase } from '@/src/lib/supabase';
import { getSocialChatImageUploadQuality } from '@/src/lib/social-chat-image-quality-preference';
import {
  SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';
import { getUserProfile } from '@/src/lib/user-profile';

export const CHAT_ROOMS_COLLECTION = 'chat_rooms';
export const SOCIAL_CHAT_MESSAGES_SUBCOLLECTION = 'messages';

export type SocialChatRoomDoc = {
  id: string;
  isGroup?: boolean;
  participantIds?: string[];
  /** 각 사용자별 마지막 읽음 메시지 id(클라이언트 기준). */
  readMessageIdBy?: Record<string, string | null | undefined>;
  /** 각 사용자별 마지막 읽음 시각(serverTimestamp). */
  readAtBy?: Record<string, unknown>;
};

export type SocialChatReplyTo = {
  messageId: string;
  senderId: string | null;
  kind?: MeetingChatMessageKind;
  imageUrl?: string | null;
  text: string;
};

export type SocialChatMessage = {
  id: string;
  senderId: string | null;
  text: string;
  kind?: MeetingChatMessageKind;
  imageUrl?: string | null;
  replyTo?: SocialChatReplyTo | null;
  createdAt: Timestamp | null;
};

const SOCIAL_LATEST_PREVIEW_LIMIT = 1;

export function socialMessageTimeMs(m: SocialChatMessage | null | undefined): number {
  const ts = m?.createdAt as Timestamp | null | undefined;
  if (!ts || typeof ts.toMillis !== 'function') return 0;
  try {
    return ts.toMillis();
  } catch {
    return 0;
  }
}

export function socialDmPreviewLine(m: SocialChatMessage | null | undefined): string {
  const t = m?.text?.trim();
  if (t) return t.length > 100 ? `${t.slice(0, 100)}…` : t;
  return '새 메시지';
}

function mapSocialMessage(id: string, data: Record<string, unknown>): SocialChatMessage {
  const senderRaw = data.senderId;
  const senderId =
    typeof senderRaw === 'string' && senderRaw.trim() ? senderRaw.trim() : null;
  const text = typeof data.text === 'string' ? data.text : '';
  const kindRaw = data.kind;
  const kind: MeetingChatMessageKind | undefined =
    kindRaw === 'system' ? 'system' : kindRaw === 'image' ? 'image' : kindRaw === 'text' ? 'text' : undefined;
  const imageRaw = data.imageUrl;
  const imageUrl =
    typeof imageRaw === 'string' && imageRaw.trim() ? imageRaw.trim() : null;
  const createdAt = (data.createdAt as Timestamp | undefined) ?? null;
  const rt = data.replyTo;
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
  return {
    id,
    senderId,
    text,
    kind,
    imageUrl,
    replyTo: replyTo?.messageId ? replyTo : null,
    createdAt,
  };
}

/** 소셜 메시지를 모임 채팅 UI(`MeetingChatMessage`)와 동일 필드로 맵핑합니다. */
export function socialMessageToMeetingMessage(m: SocialChatMessage): MeetingChatMessage {
  return {
    id: m.id,
    senderId: m.senderId,
    text: m.text,
    kind: (m.kind ?? 'text') as MeetingChatMessageKind,
    imageUrl: m.imageUrl ?? null,
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
  };
}

/** 구독 배열(오래된→최신)을 모임 채팅과 동일하게 최신이 index 0이 되도록 뒤집어 반환합니다. */
export function socialMessagesToMeetingNewestFirst(rows: SocialChatMessage[]): MeetingChatMessage[] {
  const copy = [...rows];
  copy.reverse();
  return copy.map(socialMessageToMeetingMessage);
}

/** 두 앱 사용자 PK로 결정적인 DM 룸 ID */
export function socialDmRoomId(userA: string, userB: string): string {
  const x = (normalizePhoneUserId(userA) ?? userA).trim();
  const y = (normalizePhoneUserId(userB) ?? userB).trim();
  if (!x || !y || x === y) throw new Error('유효한 상대가 필요합니다.');
  const [a, b] = x < y ? [x, y] : [y, x];
  return `social_${a}__${b}`;
}

/** `social_{a}__{b}` 형식에서 내가 아닌 상대 PK를 꺼냅니다. */
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

export async function ensureSocialChatRoomDoc(roomId: string, participantA: string, participantB: string): Promise<void> {
  const rid = roomId.trim();
  const a = (normalizePhoneUserId(participantA) ?? participantA).trim();
  const b = (normalizePhoneUserId(participantB) ?? participantB).trim();
  if (!rid || !a || !b) return;
  const dRef = doc(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid);
  const snap = await getDoc(dRef);
  if (snap.exists()) return;
  await setDoc(
    dRef,
    stripUndefinedDeep({
      isGroup: false,
      participantIds: [a, b],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}

export function subscribeSocialChatRoom(
  roomId: string,
  onRoom: (room: SocialChatRoomDoc | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const rid = roomId.trim();
  if (!rid) {
    onRoom(null);
    return () => {};
  }
  const dRef = doc(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid);
  return onSnapshot(
    dRef,
    (snap) => {
      if (!snap.exists()) {
        onRoom(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      onRoom({
        id: snap.id,
        isGroup: data.isGroup as boolean | undefined,
        participantIds: Array.isArray(data.participantIds)
          ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : undefined,
        readMessageIdBy:
          data.readMessageIdBy && typeof data.readMessageIdBy === 'object' && !Array.isArray(data.readMessageIdBy)
            ? (data.readMessageIdBy as Record<string, string | null | undefined>)
            : undefined,
        readAtBy:
          data.readAtBy && typeof data.readAtBy === 'object' && !Array.isArray(data.readAtBy)
            ? (data.readAtBy as Record<string, unknown>)
            : undefined,
      });
    },
    (err) => {
      onError?.(err.message ?? '채팅방 정보를 불러오지 못했어요.');
    },
  );
}

export async function updateSocialChatReadReceipt(roomId: string, myAppUserId: string, lastReadMessageId: string): Promise<void> {
  const rid = roomId.trim();
  const raw = String(myAppUserId ?? '').trim();
  const uidPhone = (normalizePhoneUserId(raw) ?? '').trim();
  const uidPk = (normalizeParticipantId(raw) ?? '').trim();
  const uid = (uidPhone || uidPk || raw).trim();
  const msgId = String(lastReadMessageId ?? '').trim();
  if (!rid || !uid || !msgId) return;
  const dRef = doc(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid);
  // NOTE: userId가 이메일인 경우 `.`이 포함될 수 있어, string field path(`a.b`)로 업데이트하면 키가 깨집니다.
  // FieldPath를 사용해 map key를 정확히 유지합니다.
  const pairs: unknown[] = [];
  const pushKey = (k: string) => {
    const key = k.trim();
    if (!key) return;
    pairs.push(new FieldPath('readMessageIdBy', key), msgId);
    pairs.push(new FieldPath('readAtBy', key), serverTimestamp());
  };
  pushKey(uid);
  // 기기/버전별 userId 포맷 차이를 흡수하기 위해 가능한 키를 함께 기록합니다.
  if (uidPhone && uidPhone !== uid) pushKey(uidPhone);
  if (uidPk && uidPk !== uid && uidPk !== uidPhone) pushKey(uidPk);
  if (raw && raw !== uid && raw !== uidPhone && raw !== uidPk) pushKey(raw);
  pairs.push('updatedAt', serverTimestamp());
  await updateDoc(dRef, ...(pairs as [unknown, ...unknown[]]));
}

const SOCIAL_SEARCH_PAGE = 80;

/**
 * 1:1 채팅에서 `needle`이 본문에 포함된 메시지를 과거 방향으로 스캔합니다(클라이언트 부분 문자열).
 */
export async function searchSocialChatMessages(
  roomId: string,
  needle: string,
  opts?: { maxDocsScanned?: number },
): Promise<SocialChatMessage[]> {
  const rid = roomId.trim();
  const raw = typeof needle === 'string' ? needle.trim() : '';
  if (!rid || !raw) return [];

  const maxDocs = Math.min(Math.max(100, opts?.maxDocsScanned ?? 2000), 6000);
  const norm = raw.toLowerCase();

  const matches: SocialChatMessage[] = [];
  const seen = new Set<string>();
  let lastSnap: DocumentSnapshot | undefined;
  let scanned = 0;

  const cref = collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);

  while (scanned < maxDocs) {
    const q = lastSnap
      ? query(cref, orderBy('createdAt', 'desc'), startAfter(lastSnap), limit(SOCIAL_SEARCH_PAGE))
      : query(cref, orderBy('createdAt', 'desc'), limit(SOCIAL_SEARCH_PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      const m = mapSocialMessage(d.id, d.data() as Record<string, unknown>);
      const hay = (m.text ?? '').trim().toLowerCase();
      if (hay.includes(norm) && !seen.has(m.id)) {
        seen.add(m.id);
        matches.push(m);
      }
    }
    lastSnap = snap.docs[snap.docs.length - 1]!;
    if (snap.size < SOCIAL_SEARCH_PAGE) break;
  }

  matches.sort((a, b) => {
    const ta = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return matches;
}

/** 최신 1건 미리보기(모임 채팅 `subscribeMeetingChatLatestMessage`와 동일 패턴). */
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
  const cref = collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);
  const q = query(cref, orderBy('createdAt', 'desc'), limit(SOCIAL_LATEST_PREVIEW_LIMIT));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onLatest(null);
        return;
      }
      const d = snap.docs[0]!;
      onLatest(mapSocialMessage(d.id, d.data() as Record<string, unknown>));
    },
    (err) => {
      onError?.(err.message ?? '채팅 미리보기를 불러오지 못했어요.');
    },
  );
}

export function subscribeSocialChatMessages(
  roomId: string,
  onMessages: (messages: SocialChatMessage[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const rid = roomId.trim();
  if (!rid) {
    onMessages([]);
    return () => {};
  }
  const cref = collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);
  const q = query(cref, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => mapSocialMessage(d.id, d.data() as Record<string, unknown>));
      rows.reverse();
      onMessages(rows);
    },
    (err) => {
      onError?.(err.message ?? '채팅을 불러오지 못했어요.');
    },
  );
}

function coalesceFirestoreTimeMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'object') {
    const o = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof o.toMillis === 'function') {
      try {
        return o.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof o.seconds === 'number') {
      const ns = typeof o.nanoseconds === 'number' ? o.nanoseconds : 0;
      return Math.max(0, Math.floor(o.seconds * 1000 + ns / 1e6));
    }
  }
  return 0;
}

/**
 * `chat_rooms/{roomId}` 문서의 읽음 포인터 — `app/(tabs)/chat.tsx` 미읽음 집계와 동일한 키( raw / 전화정규화 / PK ) 규칙.
 * 탭 배지(`InAppAlarmsContext`)는 AsyncStorage만 보면 서버 읽음과 어긋날 수 있어, 합산 시 이 값을 우선합니다.
 */
export async function fetchSocialChatReadPointersForUser(
  roomId: string,
  myAppUserId: string,
): Promise<{ readId: string | null; readAt: unknown | null }> {
  const rid = roomId.trim();
  const raw = String(myAppUserId ?? '').trim();
  if (!rid || !raw) return { readId: null, readAt: null };
  const mePhone = normalizePhoneUserId(raw) ?? raw;
  const mePk = normalizeParticipantId(raw) ?? raw;
  const roomSnap = await getDoc(doc(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid));
  if (!roomSnap.exists()) return { readId: null, readAt: null };
  const data = roomSnap.data() as Record<string, unknown>;
  const readMap = (data.readMessageIdBy ?? {}) as Record<string, string | null | undefined>;
  const atMap = (data.readAtBy ?? {}) as Record<string, unknown>;
  const ridFromMap = readMap[raw] ?? readMap[mePhone] ?? (mePk ? readMap[mePk] : undefined);
  const readId = typeof ridFromMap === 'string' && ridFromMap.trim() ? ridFromMap.trim() : null;
  const readAt = (atMap[raw] ?? atMap[mePhone] ?? (mePk ? atMap[mePk] : null)) ?? null;
  return { readId, readAt };
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
  const mePhone = normalizePhoneUserId(raw) ?? raw;
  const mePk = normalizeParticipantId(raw) ?? raw;

  const readId = String(myLastReadMessageId ?? '').trim();
  const readAtMs = coalesceFirestoreTimeMs(myLastReadAt);
  const maxDocs = Math.min(Math.max(50, opts?.maxDocsScanned ?? 400), 2000);

  const cref = collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);
  const q = query(cref, orderBy('createdAt', 'desc'), limit(maxDocs));
  const snap = await getDocs(q);
  if (snap.empty) return 0;

  let count = 0;
  for (const d of snap.docs) {
    const m = mapSocialMessage(d.id, d.data() as Record<string, unknown>);
    const sidRaw = (m.senderId ?? '').trim();
    const sidPhone = sidRaw ? (normalizePhoneUserId(sidRaw) ?? sidRaw) : '';
    const sidPk = sidRaw ? (normalizeParticipantId(sidRaw) ?? sidRaw) : '';
    const isMine = Boolean(sidRaw && ((sidPhone && sidPhone === mePhone) || (sidPk && sidPk === mePk)));
    // 읽음 포인터가 내가 보낸 최신 메시지일 때: 내 메시지를 먼저 continue 하면 readId에 도달하지 못해
    // 과거 상대 메시지를 전부 미읽음으로 세는 버그가 납니다. 커서 id 일치는 발신자와 무관하게 먼저 처리합니다.
    if (readId && m.id === readId) break;
    if (isMine) continue;

    const ms = socialMessageTimeMs(m);
    if (readAtMs > 0 && ms > 0 && ms <= readAtMs) break;
    // 읽음 포인터가 없다면(0) 전체를 새 메시지로 본다.
    count += 1;
  }
  return count;
}

export type SocialChatRoomSummary = {
  roomId: string;
  peerAppUserId: string;
};

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
  const q = query(
    collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION),
    where('participantIds', 'array-contains', me),
  );
  return onSnapshot(
    q,
    (snap) => {
      const out: SocialChatRoomSummary[] = [];
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        if (data.isGroup === true) continue;
        const ids = Array.isArray(data.participantIds)
          ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : [];
        const peer = ids.find((x) => (normalizePhoneUserId(x) ?? x) !== me) ?? '';
        if (peer) out.push({ roomId: d.id, peerAppUserId: normalizePhoneUserId(peer) ?? peer });
      }
      onRooms(out);
    },
    (err) => {
      onError?.(err.message ?? '소셜 채팅 목록을 불러오지 못했어요.');
    },
  );
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
  const ref = collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);
  await addDoc(
    ref,
    stripUndefinedDeep({
      senderId,
      text,
      kind: 'text' as const,
      replyTo:
        replyTo && replyTo.messageId?.trim()
          ? {
              messageId: replyTo.messageId.trim(),
              senderId: replyTo.senderId ?? null,
              kind: replyTo.kind ?? 'text',
              imageUrl: replyTo.imageUrl ?? null,
              text: String(replyTo.text ?? '').trim().slice(0, 280),
            }
          : null,
      createdAt: Timestamp.now(),
    }) as Record<string, unknown>,
  );

  if (Platform.OS !== 'web') {
    void (async () => {
      try {
        const roomSnap = await getDoc(doc(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid));
        const pdata = roomSnap.data() as Record<string, unknown> | undefined;
        const rawIds = Array.isArray(pdata?.participantIds)
          ? (pdata!.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : [];
        const meKey = normalizePhoneUserId(senderId) ?? senderId.trim();
        const peerRaw = rawIds.find((x) => (normalizePhoneUserId(x) ?? x.trim()) !== meKey);
        if (!peerRaw?.trim()) {
          ginitNotifyDbg('social-chat', 'dm_push_skip_no_peer', { rid, rawIdsLen: rawIds.length });
          return;
        }
        const peerPk =
          normalizeParticipantId(normalizePhoneUserId(peerRaw.trim()) ?? peerRaw.trim()) || peerRaw.trim();
        const senderPk = normalizeParticipantId(senderId) || senderId;
        if (!peerPk || peerPk === senderPk) {
          ginitNotifyDbg('social-chat', 'dm_push_skip_peer_same_or_empty', { rid, hasPeerPk: Boolean(peerPk) });
          return;
        }
        const prof = await getUserProfile(senderPk).catch(() => null);
        const titleNick = prof?.nickname?.trim() || '친구';
        const peerNotify = await getSocialChatNotifyEnabledForUser(rid, peerPk).catch(() => true);
        if (!peerNotify) {
          ginitNotifyDbg('social-chat', 'dm_push_skip_peer_notify_off', { rid });
          return;
        }
        ginitNotifyDbg('social-chat', 'dm_push_fire', { rid, kind: 'text' });
        sendInAppAlarmRemotePushToUserFireAndForget(peerPk, {
          kind: 'social_dm',
          meetingId: rid,
          meetingTitle: titleNick,
          preview: text.slice(0, 500),
        });
      } catch (e) {
        ginitNotifyDbg('social-chat', 'dm_push_error', { rid, message: e instanceof Error ? e.message : String(e) });
        /* ignore */
      }
    })();
  }
}

const CHAT_IMAGE_MAX_WIDTH_LOW = 1280;
const CHAT_IMAGE_MAX_WIDTH_HIGH = 1920;
const CHAT_IMAGE_JPEG_QUALITY_LOW = 0.68;
const CHAT_IMAGE_JPEG_QUALITY_HIGH = 0.86;

export type SendSocialChatImageExtras = {
  caption?: string;
  naturalWidth?: number;
};

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
  const cap = (extras?.caption ?? '').trim().slice(0, 500);
  const naturalWidth = extras?.naturalWidth;

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

  const msgRef = collection(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION);
  await addDoc(
    msgRef,
    stripUndefinedDeep({
      senderId,
      text: cap,
      kind: 'image' as const,
      imageUrl,
      createdAt: Timestamp.now(),
    }) as Record<string, unknown>,
  );

  if (Platform.OS !== 'web') {
    void (async () => {
      try {
        const roomSnap = await getDoc(doc(getFirebaseFirestore(), CHAT_ROOMS_COLLECTION, rid));
        const pdata = roomSnap.data() as Record<string, unknown> | undefined;
        const rawIds = Array.isArray(pdata?.participantIds)
          ? (pdata!.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : [];
        const meKey = normalizePhoneUserId(senderId) ?? senderId.trim();
        const peerRaw = rawIds.find((x) => (normalizePhoneUserId(x) ?? x.trim()) !== meKey);
        if (!peerRaw?.trim()) {
          ginitNotifyDbg('social-chat', 'dm_image_push_skip_no_peer', { rid, rawIdsLen: rawIds.length });
          return;
        }
        const peerPk =
          normalizeParticipantId(normalizePhoneUserId(peerRaw.trim()) ?? peerRaw.trim()) || peerRaw.trim();
        const senderPk = normalizeParticipantId(senderId) || senderId;
        if (!peerPk || peerPk === senderPk) {
          ginitNotifyDbg('social-chat', 'dm_image_push_skip_peer_same_or_empty', { rid });
          return;
        }
        const prof = await getUserProfile(senderPk).catch(() => null);
        const titleNick = prof?.nickname?.trim() || '친구';
        const imgPreview = cap ? `사진 · ${cap}` : '사진';
        const peerNotify = await getSocialChatNotifyEnabledForUser(rid, peerPk).catch(() => true);
        if (!peerNotify) {
          ginitNotifyDbg('social-chat', 'dm_image_push_skip_peer_notify_off', { rid });
          return;
        }
        ginitNotifyDbg('social-chat', 'dm_push_fire', { rid, kind: 'image' });
        sendInAppAlarmRemotePushToUserFireAndForget(peerPk, {
          kind: 'social_dm',
          meetingId: rid,
          meetingTitle: titleNick,
          preview: imgPreview,
        });
      } catch (e) {
        ginitNotifyDbg('social-chat', 'dm_image_push_error', { rid, message: e instanceof Error ? e.message : String(e) });
        /* ignore */
      }
    })();
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

  const db = getFirebaseFirestore();
  const msgRef = doc(db, CHAT_ROOMS_COLLECTION, rid, SOCIAL_CHAT_MESSAGES_SUBCOLLECTION, msgId);
  await updateDoc(msgRef, {
    kind: 'system',
    senderId: null,
    text: '사진이 삭제되었습니다.',
    imageUrl: null,
    deletedAt: serverTimestamp(),
  } as Record<string, unknown>);

  const objectPath = supabasePublicObjectPathFromUrl(url, SUPABASE_STORAGE_BUCKET_MEETING_CHAT);
  if (!objectPath) return;
  try {
    await supabase.storage.from(SUPABASE_STORAGE_BUCKET_MEETING_CHAT).remove([objectPath]);
  } catch {
    /* best-effort */
  }
}
