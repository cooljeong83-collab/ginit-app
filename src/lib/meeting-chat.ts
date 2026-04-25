/**
 * 모임 채팅 — Firestore `meetings/{meetingId}/messages` 서브컬렉션.
 *
 * 보안 규칙 예시(프로젝트에 맞게 participantIds·인증 방식 조정):
 *
 * ```
 * match /meetings/{meetingId}/messages/{msgId} {
 *   allow read: if request.auth != null;
 *   allow create: if request.auth != null
 *     && request.resource.data.senderId == request.auth.uid; // 또는 전화 PK 커스텀 클레임과 비교
 * }
 * ```
 *
 * 참가자만 쓰기·읽기를 엄격히 제한하려면 Cloud Function으로 검증하거나,
 * `participantIds` 배열과 토큰 클레임을 맞춰 규칙을 작성하세요.
 *
 * 채팅 이미지는 **Supabase Storage** 버킷 `meeting_chat` 에 저장합니다(`0021_meeting_chat_storage.sql`).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import {
  addDoc,
  collection,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  type Timestamp,
  type Unsubscribe,
  writeBatch,
} from 'firebase/firestore';
import { supabase } from '@/src/lib/supabase';
import {
  SUPABASE_STORAGE_BUCKET_MEETING_CHAT,
  uploadJpegBase64ToSupabasePublicBucket,
} from '@/src/lib/supabase-storage-upload';
import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { getFirestoreDb, MEETINGS_COLLECTION } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export const MEETING_MESSAGES_SUBCOLLECTION = 'messages';

export type MeetingChatMessageKind = 'text' | 'system' | 'image';

export type MeetingChatMessage = {
  id: string;
  senderId: string | null;
  text: string;
  kind: MeetingChatMessageKind;
  /** `kind === 'image'`일 때 다운로드 URL */
  imageUrl: string | null;
  /** 답장(인용) */
  replyTo?: {
    messageId: string;
    senderId: string | null;
    text: string;
  } | null;
  createdAt: Timestamp | null;
};

const CHAT_PAGE_SIZE = 120;

function mapMessageDoc(id: string, data: Record<string, unknown>): MeetingChatMessage {
  const senderRaw = data.senderId;
  const senderId =
    typeof senderRaw === 'string' && senderRaw.trim() ? senderRaw.trim() : null;
  const text = typeof data.text === 'string' ? data.text : '';
  const kindRaw = data.kind;
  const kind: MeetingChatMessageKind =
    kindRaw === 'system' ? 'system' : kindRaw === 'image' ? 'image' : 'text';
  const imageRaw = data.imageUrl;
  const imageUrl =
    typeof imageRaw === 'string' && imageRaw.trim() ? imageRaw.trim() : null;
  const createdAt = (data.createdAt as Timestamp | undefined) ?? null;
  const rt = data.replyTo;
  const replyTo =
    rt && typeof rt === 'object' && !Array.isArray(rt)
      ? {
          messageId: typeof (rt as Record<string, unknown>).messageId === 'string' ? String((rt as Record<string, unknown>).messageId) : '',
          senderId:
            typeof (rt as Record<string, unknown>).senderId === 'string'
              ? String((rt as Record<string, unknown>).senderId)
              : (rt as Record<string, unknown>).senderId == null
                ? null
                : String((rt as Record<string, unknown>).senderId),
          text: typeof (rt as Record<string, unknown>).text === 'string' ? String((rt as Record<string, unknown>).text) : '',
        }
      : null;
  return { id, senderId, text, kind, imageUrl, replyTo: replyTo?.messageId ? replyTo : null, createdAt };
}

/**
 * 최신 쪽부터 `CHAT_PAGE_SIZE`개 구독 후, 시간 오름차순 배열로 돌려줍니다.
 */
export function subscribeMeetingChatMessages(
  meetingId: string,
  onMessages: (messages: MeetingChatMessage[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    onMessages([]);
    return () => {};
  }
  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION, mid, MEETING_MESSAGES_SUBCOLLECTION);
  const q = query(ref, orderBy('createdAt', 'desc'), limit(CHAT_PAGE_SIZE));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => mapMessageDoc(d.id, d.data() as Record<string, unknown>));
      rows.reverse();
      onMessages(rows);
    },
    (err) => {
      onError?.(err.message ?? '채팅을 불러오지 못했어요.');
    },
  );
}

const LATEST_PREVIEW_LIMIT = 1;

/**
 * 채팅 탭 목록용 — 해당 모임의 **가장 최근 메시지 1건**만 구독합니다.
 */
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
  const cref = collection(getFirestoreDb(), MEETINGS_COLLECTION, mid, MEETING_MESSAGES_SUBCOLLECTION);
  const q = query(cref, orderBy('createdAt', 'desc'), limit(LATEST_PREVIEW_LIMIT));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onLatest(null);
        return;
      }
      const d = snap.docs[0]!;
      onLatest(mapMessageDoc(d.id, d.data() as Record<string, unknown>));
    },
    (err) => {
      onError?.(err.message ?? '채팅 미리보기를 불러오지 못했어요.');
    },
  );
}

const MESSAGE_DELETE_PAGE = 400;

/** 모임 채팅 서브컬렉션의 모든 문서를 배치로 삭제합니다(탈퇴·모임 삭제용). */
export async function deleteAllMeetingChatMessages(meetingId: string): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) return;
  const cref = collection(getFirestoreDb(), MEETINGS_COLLECTION, mid, MEETING_MESSAGES_SUBCOLLECTION);
  const db = getFirestoreDb();
  let lastId: string | undefined;
  for (;;) {
    const q =
      lastId == null
        ? query(cref, orderBy(documentId()), limit(MESSAGE_DELETE_PAGE))
        : query(cref, orderBy(documentId()), startAfter(lastId), limit(MESSAGE_DELETE_PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    const batch = writeBatch(db);
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    lastId = snap.docs[snap.docs.length - 1]!.id;
    if (snap.size < MESSAGE_DELETE_PAGE) break;
  }
}

/** 해당 사용자가 보낸 텍스트·이미지 메시지만 삭제합니다(다른 참여자 채팅은 유지). */
export async function deleteMeetingChatMessagesFromSender(meetingId: string, userId: string): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const uid = typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
  if (!mid || !uid) return;
  const ns = normalizePhoneUserId(uid) ?? uid;
  const cref = collection(getFirestoreDb(), MEETINGS_COLLECTION, mid, MEETING_MESSAGES_SUBCOLLECTION);
  const db = getFirestoreDb();
  let lastId: string | undefined;
  for (;;) {
    const q =
      lastId == null
        ? query(cref, orderBy(documentId()), limit(MESSAGE_DELETE_PAGE))
        : query(cref, orderBy(documentId()), startAfter(lastId), limit(MESSAGE_DELETE_PAGE));
    const snap = await getDocs(q);
    if (snap.empty) break;
    const batch = writeBatch(db);
    let n = 0;
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const sid = typeof data.senderId === 'string' ? data.senderId.trim() : '';
      const nsSid = sid ? normalizePhoneUserId(sid) ?? sid : '';
      if (nsSid === ns) {
        batch.delete(d.ref);
        n += 1;
      }
    }
    if (n > 0) {
      await batch.commit();
    }
    lastId = snap.docs[snap.docs.length - 1]!.id;
    if (snap.size < MESSAGE_DELETE_PAGE) break;
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

export async function sendMeetingChatTextMessage(
  meetingId: string,
  senderPhoneUserId: string,
  rawText: string,
  replyTo?: { messageId: string; senderId: string | null; text: string } | null,
): Promise<void> {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  const uid = typeof senderPhoneUserId === 'string' ? senderPhoneUserId.trim() : String(senderPhoneUserId ?? '').trim();
  if (!mid) throw new Error('모임 정보가 없습니다.');
  if (!uid) throw new Error('로그인이 필요합니다.');
  const text = rawText.trim().slice(0, 4000);
  if (!text) throw new Error('메시지를 입력해 주세요.');

  const senderId = normalizePhoneUserId(uid) ?? uid;
  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION, mid, MEETING_MESSAGES_SUBCOLLECTION);
  await addDoc(
    ref,
    stripUndefinedDeep({
      senderId,
      text,
      replyTo:
        replyTo && replyTo.messageId?.trim()
          ? {
              messageId: replyTo.messageId.trim(),
              senderId: replyTo.senderId ?? null,
              text: String(replyTo.text ?? '').trim().slice(0, 280),
            }
          : null,
      kind: 'text' as const,
      createdAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}

const CHAT_IMAGE_MAX_WIDTH = 1280;
const CHAT_IMAGE_JPEG_QUALITY = 0.68;

export type SendMeetingChatImageExtras = {
  /** 이미지 아래에 붙는 짧은 설명(선택) */
  caption?: string;
  /** 피커가 알려 주면, 가로가 이 값보다 클 때만 너비를 줄여 업스케일을 피합니다. */
  naturalWidth?: number;
};

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
  const cap = (extras?.caption ?? '').trim().slice(0, 500);
  const naturalWidth = extras?.naturalWidth;

  const actions: ImageManipulator.Action[] = [];
  if (typeof naturalWidth === 'number' && naturalWidth > CHAT_IMAGE_MAX_WIDTH) {
    actions.push({ resize: { width: CHAT_IMAGE_MAX_WIDTH } });
  }

  const manipulated = await ImageManipulator.manipulateAsync(
    uri,
    actions,
    {
      compress: CHAT_IMAGE_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

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

  const msgRef = collection(getFirestoreDb(), MEETINGS_COLLECTION, mid, MEETING_MESSAGES_SUBCOLLECTION);
  await addDoc(
    msgRef,
    stripUndefinedDeep({
      senderId,
      text: cap,
      kind: 'image' as const,
      imageUrl,
      createdAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}
