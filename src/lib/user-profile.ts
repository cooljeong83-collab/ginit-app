/**
 * Firestore `users` 컬렉션 — 문서 ID = 앱 사용자 PK.
 * - 신규: 정규화 이메일(`normalizeUserId`). `phone` 필드에 E.164(+82…)를 둡니다.
 * - 레거시: 문서 ID가 전화 PK인 계정(OTP 전용 가입 등)도 그대로 읽습니다.
 */
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { ensureFirestoreReadAuth, getFirebaseFirestore } from '@/src/lib/firebase';
import { formatNormalizedPhoneKrDisplay } from '@/src/lib/phone-user-id';

export const USERS_COLLECTION = 'users';

/** 탈퇴(익명화) 후 UI·Firestore에 고정되는 표시 닉네임 */
export const WITHDRAWN_NICKNAME = '(탈퇴한 회원)';

export type UserProfile = {
  nickname: string;
  /** HTTPS 등 원격 프로필 이미지 URL (없으면 이니셜 아바타) */
  photoUrl: string | null;
  /** 가입 시 인증한 전화(E.164). 문서 ID가 이메일일 때 조회·중복 방지용 */
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
  /** `google_sns`: SNS 간편 가입 — 성별·연령대 입력 전 모임 생성/참여 제한 */
  signupProvider?: 'google_sns' | 'phone_otp' | null;
  /** 약관 동의 시각(서버 타임스탬프). */
  termsAgreedAt?: unknown | null;
  /** 회원가입 등에서 저장하는 값 예: `MALE`, `FEMALE` */
  gender?: string | null;
  /** 연령대 구간 코드 예: `TEENS`(10대), `TWENTIES`(20대) … */
  ageBand?: string | null;
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
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const spRaw = typeof data.signupProvider === 'string' ? data.signupProvider.trim().toLowerCase() : '';
  const signupProvider = spRaw === 'google_sns' || spRaw === 'phone_otp' ? (spRaw as 'google_sns' | 'phone_otp') : null;
  const termsAgreedAt = 'termsAgreedAt' in data ? (data.termsAgreedAt as unknown) : null;
  const gender = typeof data.gender === 'string' ? data.gender.trim() : '';
  const ageBand = typeof data.ageBand === 'string' ? data.ageBand.trim() : '';
  const birthYear = typeof data.birthYear === 'number' ? data.birthYear : null;
  const birthMonth = typeof data.birthMonth === 'number' ? data.birthMonth : null;
  const birthDay = typeof data.birthDay === 'number' ? data.birthDay : null;
  const firebaseUid = typeof data.firebaseUid === 'string' ? data.firebaseUid.trim() : '';
  const base: UserProfile = {
    nickname: nick || '모임친구',
    photoUrl: photo || null,
    phone: phone || null,
    email: email || null,
    displayName: displayName || null,
    signupProvider,
    termsAgreedAt,
    gender: gender || null,
    ageBand: ageBand || null,
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
      phone: null,
      email: null,
      displayName: null,
      signupProvider: null,
      termsAgreedAt: null,
      gender: null,
      ageBand: null,
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

/** SNS(Google) 간편 가입자가 성별·연령대를 모두 채우기 전인지 — 모임 생성/참여 제한에 사용 */
export function isGoogleSnsDemographicsIncomplete(p: UserProfile | null | undefined): boolean {
  if (!p || p.signupProvider !== 'google_sns') return false;
  const g = p.gender?.trim();
  const a = p.ageBand?.trim();
  return !g || !a;
}

/** 프로필 문서가 없을 때 표시용(다른 사용자 문서 미생성 등) */
export function fallbackProfileLabel(userId: string): UserProfile {
  const t = userId.trim();
  if (t.includes('@')) {
    const local = t.split('@')[0]?.trim() ?? '';
    const nick = local.length >= 2 ? `${local.slice(0, 2)}…` : local || '회원';
    return { nickname: nick, photoUrl: null };
  }
  const digits = t.replace(/\D/g, '');
  const tail = digits.slice(-4);
  return { nickname: tail ? `회원${tail}` : '회원', photoUrl: null };
}

/**
 * 전화(E.164)로 사용자 행을 찾습니다.
 * - 레거시: `users/{전화}` 문서
 * - 신규: `users/{이메일}` 문서 중 `phone` 필드가 일치하는 문서
 */
export async function findUserRowByPhoneE164(normalizedPhone: string): Promise<{ docId: string; profile: UserProfile } | null> {
  const phone = normalizedPhone.trim();
  if (!phone) return null;
  await ensureFirestoreReadAuth();
  const db = getFirebaseFirestore();
  const legacyRef = doc(db, USERS_COLLECTION, phone);
  const legacySnap = await getDoc(legacyRef);
  if (legacySnap.exists()) {
    return { docId: phone, profile: mapUserDoc(legacySnap.data() as Record<string, unknown>) };
  }
  try {
    // 기존 데이터 마이그레이션 흔적: `users.phone` 값이 +82 / 82 / 010- / 010 등으로 섞여 있을 수 있어
    // 가능한 표현들을 함께 조회합니다(`in`은 최대 10개 제한).
    const kr = formatNormalizedPhoneKrDisplay(phone);
    const digits = kr.replace(/\D/g, '');
    const candidates = Array.from(
      new Set(
        [
          phone,
          phone.startsWith('+') ? phone.slice(1) : phone,
          kr,
          digits,
        ].map((v) => String(v ?? '').trim()).filter(Boolean),
      ),
    ).slice(0, 10);
    const qs =
      candidates.length <= 1
        ? await getDocs(query(collection(db, USERS_COLLECTION), where('phone', '==', phone), limit(3)))
        : await getDocs(query(collection(db, USERS_COLLECTION), where('phone', 'in', candidates), limit(3)));
    if (qs.empty) return null;
    const d0 = qs.docs[0];
    return { docId: d0.id, profile: mapUserDoc(d0.data() as Record<string, unknown>) };
  } catch (e) {
    /** 권한/네트워크 등 → `null`(미가입)로 삼키면 재가입이 열리므로 그대로 전파 */
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * OTP 인증 직후: 로그인에 쓸 `users` 문서 ID(이메일 또는 레거시 전화).
 * 활성(비탈퇴) 계정만 docId를 돌려줍니다.
 */
export async function resolveSessionUserIdFromVerifiedPhone(normalizedPhone: string): Promise<string | null> {
  const row = await findUserRowByPhoneE164(normalizedPhone.trim());
  if (!row) return null;
  if (isUserProfileWithdrawn(row.profile)) return null;
  return row.docId;
}

/**
 * 로그인·회원가입 UI 공통: 해당 전화(E.164)로 **로그인에 쓸 활성 `users` 문서**가 있는지.
 * `LoginScreen`의 가입 여부 판별과 동일(`resolveSessionUserIdFromVerifiedPhone` !== null).
 * `phone-registry`의 `isPhoneRegistered`(로컬 레지스트리 폴백 등)과는 구분됩니다.
 */
export async function hasLoginableUserForPhoneE164(normalizedPhone: string): Promise<boolean> {
  const docId = await resolveSessionUserIdFromVerifiedPhone(normalizedPhone.trim());
  return docId != null;
}

/**
 * 탈퇴 처리된 계정을 전화번호로 찾아 재가입 플로우용으로 되살립니다.
 * @returns 이후 `ensureUserProfile` 등에 넘길 문서 ID
 */
export async function reactivateWithdrawnUserForOtpSignup(normalizedPhone: string): Promise<string> {
  const phone = normalizedPhone.trim();
  if (!phone) throw new Error('전화번호가 없습니다.');
  const db = getFirebaseFirestore();
  const legacyRef = doc(db, USERS_COLLECTION, phone);
  const legacySnap = await getDoc(legacyRef);
  if (legacySnap.exists()) {
    const mapped = mapUserDoc(legacySnap.data() as Record<string, unknown>);
    if (mapped.isWithdrawn === true) {
      await updateDoc(
        legacyRef,
        stripUndefinedDeep({
          isWithdrawn: false,
          withdrawnAt: deleteField(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>,
      );
    }
    return phone;
  }
  const qs = await getDocs(query(collection(db, USERS_COLLECTION), where('phone', '==', phone), limit(5)));
  for (const d of qs.docs) {
    const mapped = mapUserDoc(d.data() as Record<string, unknown>);
    if (mapped.isWithdrawn === true) {
      await updateDoc(
        d.ref,
        stripUndefinedDeep({
          isWithdrawn: false,
          withdrawnAt: deleteField(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>,
      );
      return d.id;
    }
  }
  return phone;
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
  if (!id) throw new Error('사용자 ID가 없습니다.');
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
    /** E.164 전화 — 문서 ID가 이메일일 때 `phone` 필드로 저장 */
    phone?: string | null;
    email?: string | null;
    displayName?: string | null;
    signupProvider?: 'google_sns' | 'phone_otp' | null;
    /** 회원가입 시 `MALE` / `FEMALE` 권장 */
    gender?: string | null;
    /** `TEENS` … `SIXTY_PLUS` 등 연령대 구간 */
    ageBand?: string | null;
    birthYear?: number | null;
    birthMonth?: number | null;
    birthDay?: number | null;
    firebaseUid?: string | null;
  },
): Promise<UserProfile> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  const snap = await getDoc(dRef);
  const payload: Record<string, unknown> = {
    nickname: patch.nickname.trim() || generateRandomNickname(),
    photoUrl: patch.photoUrl,
    updatedAt: serverTimestamp(),
  };
  if (patch.phone !== undefined) payload.phone = patch.phone;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.displayName !== undefined) payload.displayName = patch.displayName;
  if (patch.signupProvider !== undefined) payload.signupProvider = patch.signupProvider;
  if (patch.gender !== undefined) payload.gender = patch.gender;
  if (patch.ageBand !== undefined) payload.ageBand = patch.ageBand;
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
  patch: {
    nickname?: string;
    photoUrl?: string | null;
    gender?: string | null;
    ageBand?: string | null;
  },
): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
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
  if (patch.gender !== undefined) {
    updates.gender = patch.gender && String(patch.gender).trim() ? String(patch.gender).trim() : null;
  }
  if (patch.ageBand !== undefined) {
    updates.ageBand = patch.ageBand && String(patch.ageBand).trim() ? String(patch.ageBand).trim() : null;
  }
  await updateDoc(dRef, stripUndefinedDeep(updates) as Record<string, unknown>);
}

/** 탈퇴: 채팅·투표·모임 참여 기록은 유지하고, `users` 문서의 식별 정보를 비웁니다. */
export async function withdrawAnonymizeUserProfile(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  await updateDoc(
    dRef,
    stripUndefinedDeep({
      isWithdrawn: true,
      nickname: WITHDRAWN_NICKNAME,
      photoUrl: null,
      phone: null,
      email: null,
      displayName: null,
      signupProvider: null,
      termsAgreedAt: null,
      gender: null,
      ageBand: null,
      birthYear: null,
      birthMonth: null,
      birthDay: null,
      firebaseUid: null,
      withdrawnAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}

/**
 * 구글/UID 기반 로그인 사용자 탈퇴:
 * `users` 문서의 `firebaseUid`로 역조회 후 익명화합니다.
 * 문서가 없으면 서버 익명화는 no-op으로 통과합니다.
 */
export async function withdrawAnonymizeUserProfileByFirebaseUid(firebaseUid: string): Promise<void> {
  const uid = firebaseUid.trim();
  if (!uid) throw new Error('Firebase UID가 없습니다.');
  const db = getFirebaseFirestore();
  const qs = await getDocs(query(collection(db, USERS_COLLECTION), where('firebaseUid', '==', uid)));
  if (qs.empty) return;
  await Promise.all(
    qs.docs.map(async (d) => {
      await updateDoc(
        d.ref,
        stripUndefinedDeep({
          isWithdrawn: true,
          nickname: WITHDRAWN_NICKNAME,
          photoUrl: null,
          phone: null,
          email: null,
          displayName: null,
          signupProvider: null,
          termsAgreedAt: null,
          gender: null,
          ageBand: null,
          birthYear: null,
          birthMonth: null,
          birthDay: null,
          firebaseUid: null,
          withdrawnAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>,
      );
    }),
  );
}

/** 약관 동의 기록(서버 시각 기준). */
export async function recordTermsAgreement(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  const dRef = doc(getFirebaseFirestore(), USERS_COLLECTION, id);
  await updateDoc(
    dRef,
    stripUndefinedDeep({
      termsAgreedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>,
  );
}

/** Firestore `users/{사용자 PK}` 문서를 삭제합니다(탈퇴 마지막 단계). */
export async function deleteUserProfileDocument(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
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
