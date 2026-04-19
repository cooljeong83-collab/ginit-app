/**
 * Firestore `users` 컬렉션 — 문서 ID = 정규화된 전화 PK (`+8210…`).
 * 전화 가입 시 `ensureUserProfile`으로 닉네임이 자동 생성되고, 프로필 탭에서 닉네임·사진 URL을 바꿀 수 있습니다.
 */
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { getFirebaseFirestore } from '@/src/lib/firebase';

export const USERS_COLLECTION = 'users';

export type UserProfile = {
  nickname: string;
  /** HTTPS 등 원격 프로필 이미지 URL (없으면 이니셜 아바타) */
  photoUrl: string | null;
};

const ADJECTIVES = ['즐거운', '든든한', '반짝', '포근한', '상큼한', '느긋한', '산뜻한', '따스한', '멋진', '기분좋은'] as const;
const NOUNS = [
  '두루미',
  '도토리',
  '구름',
  '라떼',
  '모카',
  '산책',
  '햇살',
  '은하수',
  '바람',
  '노을',
  '숲길',
  '파도',
  '별빛',
  '캠퍼',
  '여정',
] as const;

export function generateRandomNickname(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a}${b}`;
}

function mapUserDoc(data: Record<string, unknown>): UserProfile {
  const nick = typeof data.nickname === 'string' ? data.nickname.trim() : '';
  const photo = typeof data.photoUrl === 'string' ? data.photoUrl.trim() : '';
  return {
    nickname: nick || '모임친구',
    photoUrl: photo || null,
  };
}

/** 프로필 문서가 없을 때 표시용(다른 사용자 문서 미생성 등) */
export function fallbackProfileLabel(phoneUserId: string): UserProfile {
  const digits = phoneUserId.replace(/\D/g, '');
  const tail = digits.slice(-4);
  return { nickname: tail ? `회원${tail}` : '회원', photoUrl: null };
}

export async function getUserProfile(phoneUserId: string): Promise<UserProfile | null> {
  const id = phoneUserId.trim();
  if (!id) return null;
  const snap = await getDoc(doc(getFirebaseFirestore(), USERS_COLLECTION, id));
  if (!snap.exists()) return null;
  return mapUserDoc(snap.data() as Record<string, unknown>);
}

/**
 * 로그인 직후 등: 프로필이 없으면 랜덤 닉네임으로 생성합니다.
 */
export async function ensureUserProfile(phoneUserId: string): Promise<UserProfile> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('전화 사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  const snap = await getDoc(dRef);
  if (snap.exists()) {
    return mapUserDoc(snap.data() as Record<string, unknown>);
  }
  const nickname = generateRandomNickname();
  await setDoc(dRef, {
    nickname,
    photoUrl: null,
    createdAt: serverTimestamp(),
  });
  return { nickname, photoUrl: null };
}

export async function updateUserProfile(
  phoneUserId: string,
  patch: { nickname?: string; photoUrl?: string | null },
): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('전화 사용자 ID가 없습니다.');
  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.nickname !== undefined) {
    const n = patch.nickname.trim();
    if (!n) throw new Error('닉네임을 입력해 주세요.');
    updates.nickname = n;
  }
  if (patch.photoUrl !== undefined) {
    updates.photoUrl =
      patch.photoUrl === null || String(patch.photoUrl).trim() === '' ? null : String(patch.photoUrl).trim();
  }
  await updateDoc(doc(getFirebaseFirestore(), USERS_COLLECTION, id), stripUndefinedDeep(updates) as Record<string, unknown>);
}

export async function getUserProfilesForIds(phoneUserIds: string[]): Promise<Map<string, UserProfile>> {
  const unique = [...new Set(phoneUserIds.map((x) => x.trim()).filter(Boolean))];
  const out = new Map<string, UserProfile>();
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const p = await getUserProfile(uid);
        out.set(uid, p ?? fallbackProfileLabel(uid));
      } catch {
        out.set(uid, fallbackProfileLabel(uid));
      }
    }),
  );
  return out;
}
