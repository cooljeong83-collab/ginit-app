import {
  doc,
  FieldPath,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export const MEETING_CHAT_ROOMS_COLLECTION = 'meeting_chat_rooms';

export type MeetingChatRoomSummaryDoc = {
  id: string;
  meetingId?: string;
  unreadCountBy?: Record<string, number | null | undefined>;
  lastMessageId?: string | null;
  lastMessageAt?: unknown | null;
  lastMessagePreview?: string | null;
  lastSenderId?: string | null;
};

export function subscribeMeetingChatRoomSummary(
  meetingId: string,
  onSummary: (doc: MeetingChatRoomSummaryDoc | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const mid = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!mid) {
    onSummary(null);
    return () => {};
  }
  const ref = doc(getFirebaseFirestore(), MEETING_CHAT_ROOMS_COLLECTION, mid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onSummary(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      const unreadRaw = data.unreadCountBy ?? null;
      const unreadCountBy =
        unreadRaw && typeof unreadRaw === 'object' && !Array.isArray(unreadRaw)
          ? (unreadRaw as Record<string, number | null | undefined>)
          : undefined;
      onSummary({
        id: snap.id,
        meetingId: typeof data.meetingId === 'string' ? data.meetingId : undefined,
        unreadCountBy,
        lastMessageId: typeof data.lastMessageId === 'string' ? data.lastMessageId : data.lastMessageId == null ? null : String(data.lastMessageId ?? ''),
        lastMessageAt: (data.lastMessageAt as unknown) ?? null,
        lastMessagePreview: typeof data.lastMessagePreview === 'string' ? data.lastMessagePreview : data.lastMessagePreview == null ? null : String(data.lastMessagePreview ?? ''),
        lastSenderId: typeof data.lastSenderId === 'string' ? data.lastSenderId : data.lastSenderId == null ? null : String(data.lastSenderId ?? ''),
      });
    },
    (err) => {
      onError?.(err.message ?? '모임 채팅 요약을 불러오지 못했어요.');
    },
  );
}

function candidateUserKeys(userId: string): string[] {
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

export async function bumpMeetingChatRoomSummaryOnSend(args: {
  meetingId: string;
  senderId: string;
  messageId: string;
  preview: string;
  participantIds: (string | null | undefined)[];
}): Promise<void> {
  const mid = String(args.meetingId ?? '').trim();
  const senderRaw = String(args.senderId ?? '').trim();
  const msgId = String(args.messageId ?? '').trim();
  if (!mid || !senderRaw || !msgId) return;

  const senderKey = (normalizePhoneUserId(senderRaw) ?? senderRaw).trim();
  const senderPk = normalizeParticipantId(senderKey) || senderKey;

  const ref = doc(getFirebaseFirestore(), MEETING_CHAT_ROOMS_COLLECTION, mid);

  // ensure doc exists (merge)
  await setDoc(
    ref,
    {
      meetingId: mid,
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>,
    { merge: true },
  );

  const pairs: unknown[] = [];
  const setUnreadToZero = (k: string) => {
    const key = k.trim();
    if (!key) return;
    pairs.push(new FieldPath('unreadCountBy', key), 0);
  };
  for (const k of candidateUserKeys(senderPk)) setUnreadToZero(k);

  const incUnread = (k: string) => {
    const key = k.trim();
    if (!key) return;
    pairs.push(new FieldPath('unreadCountBy', key), increment(1));
  };
  const seen = new Set<string>();
  for (const raw of args.participantIds ?? []) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const pk = normalizeParticipantId(v) || v;
    if (!pk || pk === senderPk || seen.has(pk)) continue;
    seen.add(pk);
    for (const k of candidateUserKeys(pk)) incUnread(k);
  }

  pairs.push('lastMessageId', msgId);
  pairs.push('lastMessageAt', serverTimestamp());
  pairs.push('lastMessagePreview', String(args.preview ?? '').trim().slice(0, 500));
  pairs.push('lastSenderId', senderKey);
  pairs.push('updatedAt', serverTimestamp());

  await updateDoc(ref, ...(pairs as any));
}

export async function clearMeetingChatUnreadForUser(meetingId: string, userId: string): Promise<void> {
  const mid = String(meetingId ?? '').trim();
  const uid = String(userId ?? '').trim();
  if (!mid || !uid) return;
  const ref = doc(getFirebaseFirestore(), MEETING_CHAT_ROOMS_COLLECTION, mid);
  const pairs: unknown[] = [];
  for (const k of candidateUserKeys(uid)) {
    pairs.push(new FieldPath('unreadCountBy', k), 0);
  }
  pairs.push('updatedAt', serverTimestamp());
  try {
    await updateDoc(ref, ...(pairs as any));
  } catch {
    // 요약 문서가 아직 없을 수 있어 merge 생성 후 재시도
    await setDoc(ref, { meetingId: mid, updatedAt: serverTimestamp() } as Record<string, unknown>, { merge: true });
    await updateDoc(ref, ...(pairs as any));
  }
}

