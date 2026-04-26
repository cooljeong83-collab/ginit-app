/**
 * 1:1 소셜 채팅 — Firestore `chat_rooms/{roomId}` + `messages` 서브컬렉션.
 * `isGroup: false` 로 모임 채팅(`meetings/.../messages`)과 구분합니다.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  type DocumentSnapshot,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';

import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export const CHAT_ROOMS_COLLECTION = 'chat_rooms';
export const SOCIAL_CHAT_MESSAGES_SUBCOLLECTION = 'messages';

export type SocialChatMessage = {
  id: string;
  senderId: string | null;
  text: string;
  createdAt: Timestamp | null;
};

function mapSocialMessage(id: string, data: Record<string, unknown>): SocialChatMessage {
  const senderRaw = data.senderId;
  const senderId =
    typeof senderRaw === 'string' && senderRaw.trim() ? senderRaw.trim() : null;
  const text = typeof data.text === 'string' ? data.text : '';
  const createdAt = (data.createdAt as Timestamp | undefined) ?? null;
  return { id, senderId, text, createdAt };
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
      createdAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}
