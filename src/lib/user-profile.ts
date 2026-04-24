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

export type UserStatus = 'ACTIVE' | 'BANNED' | 'WITHDRAWN';

export type UserProfile = {
  nickname: string;
  /** HTTPS 등 원격 프로필 이미지 URL (없으면 이니셜 아바타) */
  photoUrl: string | null;
  /** 가입 시 인증한 전화(E.164). 문서 ID가 이메일일 때 조회·중복 방지용 */
  phone?: string | null;
  /** 모임 참여 제한용 전화번호 인증 완료 시각(서버 타임스탬프 권장) */
  phoneVerifiedAt?: unknown | null;
  email?: string | null;
  displayName?: string | null;
  /** `google_sns`: SNS 간편 가입 — 성별·연령대 입력 전 모임 생성/참여 제한 */
  signupProvider?: 'google_sns' | 'phone_otp' | null;
  /** 약관 동의 시각(서버 타임스탬프). */
  termsAgreedAt?: unknown | null;
  /** 마케팅 정보 수신 동의 여부 */
  isMarketingAgreed?: boolean | null;
  /** FCM 푸시 토큰(디바이스별 최신값) */
  fcmToken?: string | null;
  /** 마지막 로그인 시각(서버 타임스탬프 권장) */
  lastLoginAt?: unknown | null;
  /** 계정 상태 */
  status?: UserStatus | null;
  /** 회원가입 등에서 저장하는 값 예: `MALE`, `FEMALE` */
  gender?: string | null;
  /** 연령대 구간 코드 예: `TEENS`(10대), `TWENTIES`(20대) … */
  ageBand?: string | null;
  birthYear?: number | null;
  birthMonth?: number | null;
  birthDay?: number | null;
  /**
   * 생년월일(통합 필드, 권장).
   * - Firestore Timestamp(Date)로 저장
   * - 마이그레이션 기간 동안 birthYear/Month/Day는 "읽기 호환"만 유지
   */
  birthDate?: unknown | null;
  /** 주 활동 지역(예: 성수동, 강남역) */
  baseRegion?: string | null;
  /** 관심 카테고리 ID 리스트 */
  interests?: string[] | null;
  /** 한 줄 소개 */
  bio?: string | null;
  firebaseUid?: string | null;
  /** 지닛 게이미피케이션 */
  gLevel?: number | null;
  gXp?: number | null;
  gTrust?: number | null;
  /** 누적 패널티(노쇼·신고 승인 등) */
  penaltyCount?: number | null;
  /** 신뢰 정책상 모임 참여 제한 */
  isRestricted?: boolean | null;
  /** 체크인 완료 연속 횟수(3회마다 gTrust +5 회복) */
  trustRecoveryStreak?: number | null;
  trustRecoveryMeetingIds?: string[] | null;
  gDna?: string | null;
  meetingCount?: number | null;
  /** 시즌 랭킹 포인트 */
  rankingPoints?: number | null;
  /** 획득한 배지 ID 리스트 */
  badges?: string[] | null;

  /**
   * AI 개인화 및 취향(에이전트 최적화)
   * - 예: { vibe: 'quiet', dietary: 'vegan', preferred_time: 'evening' }
   */
  preferences?: Record<string, unknown> | null;
  /** 추천받고 싶지 않은 단어/카테고리 */
  blockedKeywords?: string[] | null;

  /** 위치 및 로컬 상권 */
  lastLocation?: unknown | null;
  /** 찜/단골 가게 ID 리스트 */
  favoriteStores?: string[] | null;

  /** 신뢰 및 안전 */
  isIdentityVerified?: boolean | null;
  /** 다른 사용자로부터 받은 누적 신고 횟수 */
  reportCount?: number | null;
  /** 유저가 직접 차단한 상대방 UID 리스트 */
  blockedUsers?: string[] | null;

  /** 경제 시스템 */
  pointBalance?: number | null;
  couponCount?: number | null;
  billingCustomerId?: string | null;

  /** 마케팅 및 성장 */
  referralCode?: string | null;
  joinPath?: string | null;
  appVersion?: string | null;

  /** 확장용 만능 메타데이터 */
  metadata?: Record<string, unknown> | null;
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

export function mapUserDoc(data: Record<string, unknown>): UserProfile {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

  const isWithdrawn = data.isWithdrawn === true;
  const nick = typeof data.nickname === 'string' ? data.nickname.trim() : '';
  const photo = typeof data.photoUrl === 'string' ? data.photoUrl.trim() : '';
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  const phoneVerifiedAt = 'phoneVerifiedAt' in data ? (data.phoneVerifiedAt as unknown) : null;
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const spRaw = typeof data.signupProvider === 'string' ? data.signupProvider.trim().toLowerCase() : '';
  const signupProvider = spRaw === 'google_sns' || spRaw === 'phone_otp' ? (spRaw as 'google_sns' | 'phone_otp') : null;
  const termsAgreedAt = 'termsAgreedAt' in data ? (data.termsAgreedAt as unknown) : null;
  const isMarketingAgreed = typeof data.isMarketingAgreed === 'boolean' ? data.isMarketingAgreed : null;
  const fcmToken = typeof data.fcmToken === 'string' ? data.fcmToken.trim() : '';
  const lastLoginAt = 'lastLoginAt' in data ? (data.lastLoginAt as unknown) : null;
  const statusRaw = typeof data.status === 'string' ? data.status.trim().toUpperCase() : '';
  const status: UserStatus | null =
    statusRaw === 'ACTIVE' || statusRaw === 'BANNED' || statusRaw === 'WITHDRAWN'
      ? (statusRaw as UserStatus)
      : null;
  const gender = typeof data.gender === 'string' ? data.gender.trim() : '';
  const ageBand = typeof data.ageBand === 'string' ? data.ageBand.trim() : '';
  const birthYear = typeof data.birthYear === 'number' ? data.birthYear : null;
  const birthMonth = typeof data.birthMonth === 'number' ? data.birthMonth : null;
  const birthDay = typeof data.birthDay === 'number' ? data.birthDay : null;
  const birthDate = 'birthDate' in data ? (data.birthDate as unknown) : null;
  const baseRegion = typeof data.baseRegion === 'string' ? data.baseRegion.trim() : '';
  const interests = Array.isArray(data.interests)
    ? (data.interests as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : null;
  const bio = typeof data.bio === 'string' ? data.bio.trim() : '';
  const firebaseUid = typeof data.firebaseUid === 'string' ? data.firebaseUid.trim() : '';
  const gLevel = typeof data.gLevel === 'number' ? Math.trunc(data.gLevel) : null;
  const gXp = typeof data.gXp === 'number' ? Math.trunc(data.gXp) : null;
  const gTrust = typeof data.gTrust === 'number' ? Math.trunc(data.gTrust) : null;
  const penaltyCount = typeof data.penaltyCount === 'number' ? Math.max(0, Math.trunc(data.penaltyCount)) : null;
  const isRestricted = data.isRestricted === true ? true : data.isRestricted === false ? false : null;
  const trustRecoveryStreak =
    typeof data.trustRecoveryStreak === 'number' && Number.isFinite(data.trustRecoveryStreak)
      ? Math.max(0, Math.trunc(data.trustRecoveryStreak))
      : null;
  const trustRecoveryMeetingIds = Array.isArray(data.trustRecoveryMeetingIds)
    ? (data.trustRecoveryMeetingIds as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : null;
  const gDna = typeof data.gDna === 'string' ? data.gDna.trim() : '';
  const meetingCount = typeof data.meetingCount === 'number' ? Math.trunc(data.meetingCount) : null;
  const rankingPoints = typeof data.rankingPoints === 'number' ? Math.trunc(data.rankingPoints) : null;
  const badges = Array.isArray(data.badges)
    ? (data.badges as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    : null;
  const preferences = isPlainObject(data.preferences) ? (data.preferences as Record<string, unknown>) : null;
  const blockedKeywords = Array.isArray(data.blockedKeywords)
    ? (data.blockedKeywords as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : null;
  const lastLocation = 'lastLocation' in data ? (data.lastLocation as unknown) : null;
  const favoriteStores = Array.isArray(data.favoriteStores)
    ? (data.favoriteStores as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : null;
  const isIdentityVerified = typeof data.isIdentityVerified === 'boolean' ? data.isIdentityVerified : null;
  const reportCount = typeof data.reportCount === 'number' ? Math.trunc(data.reportCount) : null;
  const blockedUsers = Array.isArray(data.blockedUsers)
    ? (data.blockedUsers as unknown[])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    : null;
  const pointBalance = typeof data.pointBalance === 'number' ? Math.trunc(data.pointBalance) : null;
  const couponCount = typeof data.couponCount === 'number' ? Math.trunc(data.couponCount) : null;
  const billingCustomerId = typeof data.billingCustomerId === 'string' ? data.billingCustomerId.trim() : '';
  const referralCode = typeof data.referralCode === 'string' ? data.referralCode.trim() : '';
  const joinPath = typeof data.joinPath === 'string' ? data.joinPath.trim() : '';
  const appVersion = typeof data.appVersion === 'string' ? data.appVersion.trim() : '';
  const metadata = isPlainObject(data.metadata) ? (data.metadata as Record<string, unknown>) : null;
  const base: UserProfile = {
    nickname: nick || '모임친구',
    photoUrl: photo || null,
    phone: phone || null,
    phoneVerifiedAt,
    email: email || null,
    displayName: displayName || null,
    signupProvider,
    termsAgreedAt,
    isMarketingAgreed,
    fcmToken: fcmToken || null,
    lastLoginAt,
    status,
    gender: gender || null,
    ageBand: ageBand || null,
    birthYear,
    birthMonth,
    birthDay,
    birthDate,
    baseRegion: baseRegion || null,
    interests,
    bio: bio || null,
    firebaseUid: firebaseUid || null,
    gLevel,
    gXp,
    gTrust,
    penaltyCount,
    isRestricted,
    trustRecoveryStreak,
    trustRecoveryMeetingIds,
    gDna: gDna || null,
    meetingCount,
    rankingPoints,
    badges,
    preferences,
    blockedKeywords,
    lastLocation,
    favoriteStores,
    isIdentityVerified,
    reportCount,
    blockedUsers,
    pointBalance,
    couponCount,
    billingCustomerId: billingCustomerId || null,
    referralCode: referralCode || null,
    joinPath: joinPath || null,
    appVersion: appVersion || null,
    metadata,
    isWithdrawn,
  };
  if (isWithdrawn) {
    return {
      ...base,
      nickname: WITHDRAWN_NICKNAME,
      photoUrl: null,
      phone: null,
      phoneVerifiedAt: null,
      email: null,
      displayName: null,
      signupProvider: null,
      termsAgreedAt: null,
      isMarketingAgreed: null,
      fcmToken: null,
      lastLoginAt: null,
      status: 'WITHDRAWN',
      gender: null,
      ageBand: null,
      birthYear: null,
      birthMonth: null,
      birthDay: null,
      birthDate: null,
      baseRegion: null,
      interests: null,
      bio: null,
      firebaseUid: null,
      rankingPoints: null,
      badges: null,
      preferences: null,
      blockedKeywords: null,
      lastLocation: null,
      favoriteStores: null,
      isIdentityVerified: null,
      reportCount: null,
      blockedUsers: null,
      pointBalance: null,
      couponCount: null,
      billingCustomerId: null,
      referralCode: null,
      joinPath: null,
      appVersion: null,
      metadata: null,
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
  const bd = p.birthDate ?? null;
  // birthDate가 없으면(레거시) 기존 필드로도 체크
  const y = p.birthYear ?? null;
  const m = p.birthMonth ?? null;
  const d = p.birthDay ?? null;
  return !g || (!bd && (!y || !m || !d));
}

/** 모임 참여 제한용: 전화번호 인증 완료 사용자 여부 */
export function isUserPhoneVerified(p: UserProfile | null | undefined): boolean {
  if (!p || p.isWithdrawn === true) return false;
  // OTP 가입/로그인은 Firebase Phone Auth를 거치므로 기본적으로 verified로 취급합니다.
  if (p.signupProvider === 'phone_otp') return true;
  return p.phoneVerifiedAt != null;
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
    status: 'ACTIVE',
    isMarketingAgreed: false,
    fcmToken: null,
    lastLoginAt: serverTimestamp(),
    baseRegion: null,
    interests: [],
    bio: null,
    gLevel: 1,
    gXp: 0,
    gTrust: 100,
    penaltyCount: 0,
    isRestricted: false,
    trustRecoveryStreak: 0,
    trustRecoveryMeetingIds: [],
    gDna: 'Explorer',
    meetingCount: 0,
    rankingPoints: 0,
    badges: [],
    preferences: {},
    blockedKeywords: [],
    lastLocation: null,
    favoriteStores: [],
    isIdentityVerified: false,
    reportCount: 0,
    blockedUsers: [],
    pointBalance: 0,
    couponCount: 0,
    billingCustomerId: null,
    referralCode: null,
    joinPath: null,
    appVersion: null,
    metadata: {},
    createdAt: serverTimestamp(),
  });
  return {
    nickname,
    photoUrl: null,
    status: 'ACTIVE',
    isMarketingAgreed: false,
    fcmToken: null,
    lastLoginAt: null,
    baseRegion: null,
    interests: [],
    bio: null,
    gLevel: 1,
    gXp: 0,
    gTrust: 100,
    penaltyCount: 0,
    isRestricted: false,
    trustRecoveryStreak: 0,
    trustRecoveryMeetingIds: [],
    gDna: 'Explorer',
    meetingCount: 0,
    rankingPoints: 0,
    badges: [],
    preferences: {},
    blockedKeywords: [],
    lastLocation: null,
    favoriteStores: [],
    isIdentityVerified: false,
    reportCount: 0,
    blockedUsers: [],
    pointBalance: 0,
    couponCount: 0,
    billingCustomerId: null,
    referralCode: null,
    joinPath: null,
    appVersion: null,
    metadata: {},
  };
}

/** 구글 가입 직후: Firestore 사용자 문서에 계정·People API 정보 병합(신규는 생성). */
export async function applyGoogleSignupProfile(
  phoneUserId: string,
  patch: {
    nickname: string;
    photoUrl: string | null;
    /** E.164 전화 — 문서 ID가 이메일일 때 `phone` 필드로 저장 */
    phone?: string | null;
    /** 전화번호 인증 완료 시각(서버 타임스탬프 권장) */
    phoneVerifiedAt?: unknown | null;
    email?: string | null;
    displayName?: string | null;
    signupProvider?: 'google_sns' | 'phone_otp' | null;
    /** 회원가입 시 `MALE` / `FEMALE` 권장 */
    gender?: string | null;
    /** `TEENS` … `SIXTY_PLUS` 등 연령대 구간 */
    ageBand?: string | null;
    /** 레거시 호환: 더 이상 쓰지 않음(읽기만). */
    birthYear?: number | null;
    /** 레거시 호환: 더 이상 쓰지 않음(읽기만). */
    birthMonth?: number | null;
    /** 레거시 호환: 더 이상 쓰지 않음(읽기만). */
    birthDay?: number | null;
    /** 권장: Timestamp(Date) */
    birthDate?: unknown | null;
    baseRegion?: string | null;
    interests?: string[] | null;
    bio?: string | null;
    firebaseUid?: string | null;
    /** 지닛 게이미피케이션(없으면 신규 생성 시 기본값) */
    gLevel?: number | null;
    gXp?: number | null;
    gTrust?: number | null;
    gDna?: string | null;
    meetingCount?: number | null;
    rankingPoints?: number | null;
    badges?: string[] | null;
    status?: UserStatus | null;
    isMarketingAgreed?: boolean | null;
    fcmToken?: string | null;
    lastLoginAt?: unknown | null;
    preferences?: Record<string, unknown> | null;
    blockedKeywords?: string[] | null;
    lastLocation?: unknown | null;
    favoriteStores?: string[] | null;
    isIdentityVerified?: boolean | null;
    reportCount?: number | null;
    blockedUsers?: string[] | null;
    pointBalance?: number | null;
    couponCount?: number | null;
    billingCustomerId?: string | null;
    referralCode?: string | null;
    joinPath?: string | null;
    appVersion?: string | null;
    metadata?: Record<string, unknown> | null;
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
  if (patch.phoneVerifiedAt !== undefined) payload.phoneVerifiedAt = patch.phoneVerifiedAt;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.displayName !== undefined) payload.displayName = patch.displayName;
  if (patch.signupProvider !== undefined) payload.signupProvider = patch.signupProvider;
  if (patch.gender !== undefined) payload.gender = patch.gender;
  if (patch.ageBand !== undefined) payload.ageBand = patch.ageBand;
  if (patch.birthDate !== undefined) payload.birthDate = patch.birthDate;
  if (patch.baseRegion !== undefined) payload.baseRegion = patch.baseRegion;
  if (patch.interests !== undefined) payload.interests = patch.interests;
  if (patch.bio !== undefined) payload.bio = patch.bio;
  if (patch.firebaseUid !== undefined) payload.firebaseUid = patch.firebaseUid;
  if (patch.gLevel !== undefined) payload.gLevel = patch.gLevel;
  if (patch.gXp !== undefined) payload.gXp = patch.gXp;
  if (patch.gTrust !== undefined) payload.gTrust = patch.gTrust;
  if (patch.gDna !== undefined) payload.gDna = patch.gDna;
  if (patch.meetingCount !== undefined) payload.meetingCount = patch.meetingCount;
  if (patch.rankingPoints !== undefined) payload.rankingPoints = patch.rankingPoints;
  if (patch.badges !== undefined) payload.badges = patch.badges;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.isMarketingAgreed !== undefined) payload.isMarketingAgreed = patch.isMarketingAgreed;
  if (patch.fcmToken !== undefined) payload.fcmToken = patch.fcmToken;
  if (patch.lastLoginAt !== undefined) payload.lastLoginAt = patch.lastLoginAt;
  if (patch.preferences !== undefined) payload.preferences = patch.preferences;
  if (patch.blockedKeywords !== undefined) payload.blockedKeywords = patch.blockedKeywords;
  if (patch.lastLocation !== undefined) payload.lastLocation = patch.lastLocation;
  if (patch.favoriteStores !== undefined) payload.favoriteStores = patch.favoriteStores;
  if (patch.isIdentityVerified !== undefined) payload.isIdentityVerified = patch.isIdentityVerified;
  if (patch.reportCount !== undefined) payload.reportCount = patch.reportCount;
  if (patch.blockedUsers !== undefined) payload.blockedUsers = patch.blockedUsers;
  if (patch.pointBalance !== undefined) payload.pointBalance = patch.pointBalance;
  if (patch.couponCount !== undefined) payload.couponCount = patch.couponCount;
  if (patch.billingCustomerId !== undefined) payload.billingCustomerId = patch.billingCustomerId;
  if (patch.referralCode !== undefined) payload.referralCode = patch.referralCode;
  if (patch.joinPath !== undefined) payload.joinPath = patch.joinPath;
  if (patch.appVersion !== undefined) payload.appVersion = patch.appVersion;
  if (patch.metadata !== undefined) payload.metadata = patch.metadata;
  if (snap.exists()) {
    const prev = mapUserDoc(snap.data() as Record<string, unknown>);
    if (prev.isWithdrawn === true) {
      (payload as Record<string, unknown>).isWithdrawn = false;
      (payload as Record<string, unknown>).withdrawnAt = deleteField();
    }
  }
  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
    if (payload.status === undefined) payload.status = 'ACTIVE';
    if (payload.isMarketingAgreed === undefined) payload.isMarketingAgreed = false;
    if (payload.fcmToken === undefined) payload.fcmToken = null;
    if (payload.lastLoginAt === undefined) payload.lastLoginAt = serverTimestamp();
    if (payload.baseRegion === undefined) payload.baseRegion = null;
    if (payload.interests === undefined) payload.interests = [];
    if (payload.bio === undefined) payload.bio = null;
    // 어떤 가입 방식이든 기본 게이미피케이션 컬럼을 생성합니다.
    if (payload.gLevel === undefined) payload.gLevel = 1;
    if (payload.gXp === undefined) payload.gXp = 0;
    if (payload.gTrust === undefined) payload.gTrust = 100;
    if (payload.penaltyCount === undefined) payload.penaltyCount = 0;
    if (payload.isRestricted === undefined) payload.isRestricted = false;
    if (payload.trustRecoveryStreak === undefined) payload.trustRecoveryStreak = 0;
    if (payload.trustRecoveryMeetingIds === undefined) payload.trustRecoveryMeetingIds = [];
    if (payload.gDna === undefined) payload.gDna = 'Explorer';
    if (payload.meetingCount === undefined) payload.meetingCount = 0;
    if (payload.rankingPoints === undefined) payload.rankingPoints = 0;
    if (payload.badges === undefined) payload.badges = [];
    if (payload.preferences === undefined) payload.preferences = {};
    if (payload.blockedKeywords === undefined) payload.blockedKeywords = [];
    if (payload.lastLocation === undefined) payload.lastLocation = null;
    if (payload.favoriteStores === undefined) payload.favoriteStores = [];
    if (payload.isIdentityVerified === undefined) payload.isIdentityVerified = false;
    if (payload.reportCount === undefined) payload.reportCount = 0;
    if (payload.blockedUsers === undefined) payload.blockedUsers = [];
    if (payload.pointBalance === undefined) payload.pointBalance = 0;
    if (payload.couponCount === undefined) payload.couponCount = 0;
    if (payload.billingCustomerId === undefined) payload.billingCustomerId = null;
    if (payload.referralCode === undefined) payload.referralCode = null;
    if (payload.joinPath === undefined) payload.joinPath = null;
    if (payload.appVersion === undefined) payload.appVersion = null;
    if (payload.metadata === undefined) payload.metadata = {};
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
    /** 더 이상 사용하지 않음(레거시 호환). */
    ageBand?: string | null;
    /** 레거시 호환: 더 이상 쓰지 않음(읽기만). */
    birthYear?: number | null;
    /** 레거시 호환: 더 이상 쓰지 않음(읽기만). */
    birthMonth?: number | null;
    /** 레거시 호환: 더 이상 쓰지 않음(읽기만). */
    birthDay?: number | null;
    /** 권장: Timestamp(Date) */
    birthDate?: unknown | null;
    baseRegion?: string | null;
    interests?: string[] | null;
    bio?: string | null;
    status?: UserStatus | null;
    isMarketingAgreed?: boolean | null;
    fcmToken?: string | null;
    lastLoginAt?: unknown | null;
    rankingPoints?: number | null;
    badges?: string[] | null;
    phone?: string | null;
    phoneVerifiedAt?: unknown | null;
    preferences?: Record<string, unknown> | null;
    blockedKeywords?: string[] | null;
    lastLocation?: unknown | null;
    favoriteStores?: string[] | null;
    isIdentityVerified?: boolean | null;
    reportCount?: number | null;
    blockedUsers?: string[] | null;
    pointBalance?: number | null;
    couponCount?: number | null;
    billingCustomerId?: string | null;
    referralCode?: string | null;
    joinPath?: string | null;
    appVersion?: string | null;
    metadata?: Record<string, unknown> | null;
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
  if (patch.birthDate !== undefined) {
    updates.birthDate = patch.birthDate;
  }
  if (patch.baseRegion !== undefined) {
    const t = patch.baseRegion && String(patch.baseRegion).trim() ? String(patch.baseRegion).trim() : null;
    updates.baseRegion = t;
  }
  if (patch.interests !== undefined) {
    updates.interests = Array.isArray(patch.interests)
      ? patch.interests.map((x) => String(x).trim()).filter(Boolean)
      : patch.interests == null
        ? null
        : [];
  }
  if (patch.bio !== undefined) {
    const t = patch.bio && String(patch.bio).trim() ? String(patch.bio).trim() : null;
    updates.bio = t;
  }
  if (patch.status !== undefined) {
    updates.status = patch.status;
  }
  if (patch.isMarketingAgreed !== undefined) {
    updates.isMarketingAgreed = patch.isMarketingAgreed;
  }
  if (patch.fcmToken !== undefined) {
    const t = patch.fcmToken && String(patch.fcmToken).trim() ? String(patch.fcmToken).trim() : null;
    updates.fcmToken = t;
  }
  if (patch.lastLoginAt !== undefined) {
    updates.lastLoginAt = patch.lastLoginAt;
  }
  if (patch.rankingPoints !== undefined) {
    const n = patch.rankingPoints;
    updates.rankingPoints = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (patch.badges !== undefined) {
    updates.badges = Array.isArray(patch.badges)
      ? patch.badges.map((x) => String(x).trim()).filter(Boolean)
      : patch.badges == null
        ? null
        : [];
  }
  if (patch.phone !== undefined) {
    updates.phone = patch.phone && String(patch.phone).trim() ? String(patch.phone).trim() : null;
  }
  if (patch.phoneVerifiedAt !== undefined) {
    updates.phoneVerifiedAt = patch.phoneVerifiedAt;
  }
  if (patch.preferences !== undefined) {
    updates.preferences = patch.preferences && typeof patch.preferences === 'object' && !Array.isArray(patch.preferences) ? patch.preferences : patch.preferences == null ? null : {};
  }
  if (patch.blockedKeywords !== undefined) {
    updates.blockedKeywords = Array.isArray(patch.blockedKeywords)
      ? patch.blockedKeywords.map((x) => String(x).trim()).filter(Boolean)
      : patch.blockedKeywords == null
        ? null
        : [];
  }
  if (patch.lastLocation !== undefined) {
    updates.lastLocation = patch.lastLocation;
  }
  if (patch.favoriteStores !== undefined) {
    updates.favoriteStores = Array.isArray(patch.favoriteStores)
      ? patch.favoriteStores.map((x) => String(x).trim()).filter(Boolean)
      : patch.favoriteStores == null
        ? null
        : [];
  }
  if (patch.isIdentityVerified !== undefined) {
    updates.isIdentityVerified = typeof patch.isIdentityVerified === 'boolean' ? patch.isIdentityVerified : null;
  }
  if (patch.reportCount !== undefined) {
    const n = patch.reportCount;
    updates.reportCount = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (patch.blockedUsers !== undefined) {
    updates.blockedUsers = Array.isArray(patch.blockedUsers)
      ? patch.blockedUsers.map((x) => String(x).trim()).filter(Boolean)
      : patch.blockedUsers == null
        ? null
        : [];
  }
  if (patch.pointBalance !== undefined) {
    const n = patch.pointBalance;
    updates.pointBalance = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (patch.couponCount !== undefined) {
    const n = patch.couponCount;
    updates.couponCount = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (patch.billingCustomerId !== undefined) {
    updates.billingCustomerId = patch.billingCustomerId && String(patch.billingCustomerId).trim() ? String(patch.billingCustomerId).trim() : null;
  }
  if (patch.referralCode !== undefined) {
    updates.referralCode = patch.referralCode && String(patch.referralCode).trim() ? String(patch.referralCode).trim() : null;
  }
  if (patch.joinPath !== undefined) {
    updates.joinPath = patch.joinPath && String(patch.joinPath).trim() ? String(patch.joinPath).trim() : null;
  }
  if (patch.appVersion !== undefined) {
    updates.appVersion = patch.appVersion && String(patch.appVersion).trim() ? String(patch.appVersion).trim() : null;
  }
  if (patch.metadata !== undefined) {
    updates.metadata = patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata) ? patch.metadata : patch.metadata == null ? null : {};
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
      birthDate: null,
      preferences: null,
      blockedKeywords: null,
      lastLocation: null,
      favoriteStores: null,
      isIdentityVerified: null,
      reportCount: null,
      blockedUsers: null,
      pointBalance: null,
      couponCount: null,
      billingCustomerId: null,
      referralCode: null,
      joinPath: null,
      appVersion: null,
      metadata: null,
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
          birthDate: null,
          preferences: null,
          blockedKeywords: null,
          lastLocation: null,
          favoriteStores: null,
          isIdentityVerified: null,
          reportCount: null,
          blockedUsers: null,
          pointBalance: null,
          couponCount: null,
          billingCustomerId: null,
          referralCode: null,
          joinPath: null,
          appVersion: null,
          metadata: null,
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
