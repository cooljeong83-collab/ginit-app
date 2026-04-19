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
 */
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';

import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { getFirestoreDb, MEETINGS_COLLECTION } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export const MEETING_MESSAGES_SUBCOLLECTION = 'messages';

export type MeetingChatMessageKind = 'text' | 'system';

export type MeetingChatMessage = {
  id: string;
  senderId: string | null;
  text: string;
  kind: MeetingChatMessageKind;
  createdAt: Timestamp | null;
};

const CHAT_PAGE_SIZE = 120;

function mapMessageDoc(id: string, data: Record<string, unknown>): MeetingChatMessage {
  const senderRaw = data.senderId;
  const senderId =
    typeof senderRaw === 'string' && senderRaw.trim() ? senderRaw.trim() : null;
  const text = typeof data.text === 'string' ? data.text : '';
  const kind: MeetingChatMessageKind = data.kind === 'system' ? 'system' : 'text';
  const createdAt = (data.createdAt as Timestamp | undefined) ?? null;
  return { id, senderId, text, kind, createdAt };
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

export async function sendMeetingChatTextMessage(
  meetingId: string,
  senderPhoneUserId: string,
  rawText: string,
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
      kind: 'text' as const,
      createdAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}
