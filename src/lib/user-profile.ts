/**
 * Firestore `users` 컬렉션 — 문서 ID = 정규화된 전화 PK (`+8210…`).
 * 전화 가입 시 `ensureUserProfile`으로 닉네임이 자동 생성되고, 프로필 탭에서 닉네임·사진 URL을 바꿀 수 있습니다.
 */
import { deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { getFirebaseAuth, getFirebaseFirestore } from '@/src/lib/firebase';

export const USERS_COLLECTION = 'users';

/** 탈퇴(익명화) 후 UI·Firestore에 고정되는 표시 닉네임 */
export const WITHDRAWN_NICKNAME = '(탈퇴한 회원)';

export type UserProfile = {
  nickname: string;
  /** HTTPS 등 원격 프로필 이미지 URL (없으면 이니셜 아바타) */
  photoUrl: string | null;
  email?: string | null;
  displayName?: string | null;
  /** 회원가입 등에서 저장하는 값 예: `MALE`, `FEMALE` */
  gender?: string | null;
  birthYear?: number | null;
  birthMonth?: number | null;
  birthDay?: number | null;
  firebaseUid?: string | null;
  /** 탈퇴 처리 시 개인정보는 null로 비우고 메시지 등은 senderId로만 연결 */
  isWithdrawn?: boolean;
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
  const isWithdrawn = data.isWithdrawn === true;
  const nick = typeof data.nickname === 'string' ? data.nickname.trim() : '';
  const photo = typeof data.photoUrl === 'string' ? data.photoUrl.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const gender = typeof data.gender === 'string' ? data.gender.trim() : '';
  const birthYear = typeof data.birthYear === 'number' ? data.birthYear : null;
  const birthMonth = typeof data.birthMonth === 'number' ? data.birthMonth : null;
  const birthDay = typeof data.birthDay === 'number' ? data.birthDay : null;
  const firebaseUid = typeof data.firebaseUid === 'string' ? data.firebaseUid.trim() : '';
  const base: UserProfile = {
    nickname: nick || '모임친구',
    photoUrl: photo || null,
    email: email || null,
    displayName: displayName || null,
    gender: gender || null,
    birthYear,
    birthMonth,
    birthDay,
    firebaseUid: firebaseUid || null,
    isWithdrawn,
  };
  if (isWithdrawn) {
    return {
      ...base,
      nickname: WITHDRAWN_NICKNAME,
      photoUrl: null,
      email: null,
      displayName: null,
      gender: null,
      birthYear: null,
      birthMonth: null,
      birthDay: null,
      firebaseUid: null,
      isWithdrawn: true,
    };
  }
  return base;
}

export function isUserProfileWithdrawn(p: UserProfile | null | undefined): boolean {
  return p?.isWithdrawn === true;
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
    const mapped = mapUserDoc(snap.data() as Record<string, unknown>);
    // 탈퇴 계정은 자동으로 재활성화하지 않습니다(재가입 플로우에서만 명시적으로 처리).
    if (mapped.isWithdrawn === true) return mapped;
    return mapped;
  }
  const nickname = generateRandomNickname();
  await setDoc(dRef, {
    nickname,
    photoUrl: null,
    createdAt: serverTimestamp(),
  });
  return { nickname, photoUrl: null };
}

/** 구글 가입 직후: Firestore 사용자 문서에 계정·People API 정보 병합(신규는 생성). */
export async function applyGoogleSignupProfile(
  phoneUserId: string,
  patch: {
    nickname: string;
    photoUrl: string | null;
    email?: string | null;
    displayName?: string | null;
    /** 회원가입 시 `MALE` / `FEMALE` 권장 */
    gender?: string | null;
    birthYear?: number | null;
    birthMonth?: number | null;
    birthDay?: number | null;
    firebaseUid?: string | null;
  },
): Promise<UserProfile> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('전화 사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  const snap = await getDoc(dRef);
  const payload: Record<string, unknown> = {
    nickname: patch.nickname.trim() || generateRandomNickname(),
    photoUrl: patch.photoUrl,
    updatedAt: serverTimestamp(),
  };
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.displayName !== undefined) payload.displayName = patch.displayName;
  if (patch.gender !== undefined) payload.gender = patch.gender;
  if (patch.birthYear !== undefined) payload.birthYear = patch.birthYear;
  if (patch.birthMonth !== undefined) payload.birthMonth = patch.birthMonth;
  if (patch.birthDay !== undefined) payload.birthDay = patch.birthDay;
  if (patch.firebaseUid !== undefined) payload.firebaseUid = patch.firebaseUid;
  if (snap.exists()) {
    const prev = mapUserDoc(snap.data() as Record<string, unknown>);
    if (prev.isWithdrawn === true) {
      (payload as Record<string, unknown>).isWithdrawn = false;
      (payload as Record<string, unknown>).withdrawnAt = deleteField();
    }
  }
  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(dRef, stripUndefinedDeep(payload) as Record<string, unknown>, { merge: true });
  const after = await getDoc(dRef);
  return mapUserDoc((after.data() ?? {}) as Record<string, unknown>);
}

export async function updateUserProfile(
  phoneUserId: string,
  patch: { nickname?: string; photoUrl?: string | null },
): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('전화 사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  const existing = await getDoc(dRef);
  if (existing.exists()) {
    const mapped = mapUserDoc(existing.data() as Record<string, unknown>);
    if (mapped.isWithdrawn === true) {
      throw new Error('탈퇴 처리된 계정은 프로필을 수정할 수 없습니다.');
    }
  }
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
  await updateDoc(dRef, stripUndefinedDeep(updates) as Record<string, unknown>);
}

/** 탈퇴: 채팅·투표·모임 참여 기록은 유지하고, `users` 문서의 식별 정보를 비웁니다. */
export async function withdrawAnonymizeUserProfile(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('전화 사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  await updateDoc(
    dRef,
    stripUndefinedDeep({
      isWithdrawn: true,
      nickname: WITHDRAWN_NICKNAME,
      photoUrl: null,
      email: null,
      displayName: null,
      gender: null,
      birthYear: null,
      birthMonth: null,
      birthDay: null,
      firebaseUid: null,
      withdrawnAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}

/** Firestore `users/{전화 PK}` 문서를 삭제합니다(탈퇴 마지막 단계). */
export async function deleteUserProfileDocument(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('전화 사용자 ID가 없습니다.');
  await deleteDoc(doc(getFirebaseFirestore(), USERS_COLLECTION, id));
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
