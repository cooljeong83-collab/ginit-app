/**
 * Firestore `users` 컬렉션 — 문서 ID = 앱 사용자 PK.
 * - 신규: 정규화 이메일(`normalizeUserId`). `phone` 필드에 E.164(+82…)를 둡니다.
 * - 레거시: 문서 ID가 전화 PK인 계정(OTP 전용 가입 등)도 그대로 읽습니다.
 */
import {
  doc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '@/src/lib/firebase';
import { profilesSource } from '@/src/lib/hybrid-data-source';
import { supabase } from '@/src/lib/supabase';
import { MEETING_PHONE_VERIFICATION_UI_ENABLED } from './meeting-phone-verification-ui';

export const USERS_COLLECTION = 'users';

/** 탈퇴(익명화) 후 UI·Firestore에 고정되는 표시 닉네임 */
export const WITHDRAWN_NICKNAME = '(탈퇴한 회원)';

/** Google People 동의로 확정된 성별 — 서비스 이용 인증·프로필에서 수정 불가 */
export const PROFILE_META_GOOGLE_DEMO_GENDER_LOCKED = 'ginit_google_demo_gender_locked' as const;
/** Google People 동의로 확정된 생년월일 — 동일하게 수정 불가 */
export const PROFILE_META_GOOGLE_DEMO_BIRTH_LOCKED = 'ginit_google_demo_birth_locked' as const;

export function buildGooglePeopleDemographicsMetadataPatch(opts: {
  genderFromGoogle?: boolean;
  birthFromGoogle?: boolean;
}): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (opts.genderFromGoogle) o[PROFILE_META_GOOGLE_DEMO_GENDER_LOCKED] = true;
  if (opts.birthFromGoogle) o[PROFILE_META_GOOGLE_DEMO_BIRTH_LOCKED] = true;
  return o;
}

export function readGooglePeopleDemographicsLocks(p: UserProfile | null | undefined): {
  genderLocked: boolean;
  birthLocked: boolean;
} {
  const m = p?.metadata;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { genderLocked: false, birthLocked: false };
  const rec = m as Record<string, unknown>;
  return {
    genderLocked: rec[PROFILE_META_GOOGLE_DEMO_GENDER_LOCKED] === true,
    birthLocked: rec[PROFILE_META_GOOGLE_DEMO_BIRTH_LOCKED] === true,
  };
}

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
  /** 마지막 FCM 토큰 등록 OS — Edge 푸시 분기용 */
  fcmPlatform?: 'ios' | 'android' | null;
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

/** RPC·JSON 경로에서 int가 문자열로 올 때 `isDemographicsIncomplete` 오판을 막습니다. */
function readFiniteIntField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
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
  const fpRaw = typeof data.fcmPlatform === 'string' ? data.fcmPlatform.trim().toLowerCase() : '';
  const fcmPlatform = fpRaw === 'ios' || fpRaw === 'android' ? (fpRaw as 'ios' | 'android') : null;
  const lastLoginAt = 'lastLoginAt' in data ? (data.lastLoginAt as unknown) : null;
  const statusRaw = typeof data.status === 'string' ? data.status.trim().toUpperCase() : '';
  const status: UserStatus | null =
    statusRaw === 'ACTIVE' || statusRaw === 'BANNED' || statusRaw === 'WITHDRAWN'
      ? (statusRaw as UserStatus)
      : null;
  const gender = typeof data.gender === 'string' ? data.gender.trim() : '';
  const ageBand = typeof data.ageBand === 'string' ? data.ageBand.trim() : '';
  const birthYear = readFiniteIntField(data.birthYear);
  const birthMonth = readFiniteIntField(data.birthMonth);
  const birthDay = readFiniteIntField(data.birthDay);
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
    fcmPlatform,
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
      fcmPlatform: null,
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
      gLevel: null,
      gXp: null,
      gTrust: null,
      penaltyCount: null,
      isRestricted: null,
      trustRecoveryStreak: null,
      trustRecoveryMeetingIds: null,
      gDna: null,
      meetingCount: null,
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

/** 성별·생년(또는 생년월일 분필드) 미입력 여부 */
export function isDemographicsIncomplete(p: UserProfile | null | undefined): boolean {
  if (!p) return true;
  const g = p.gender?.trim();
  const bd = p.birthDate ?? null;
  const y = p.birthYear ?? null;
  const m = p.birthMonth ?? null;
  const d = p.birthDay ?? null;
  return !g || (!bd && (!y || !m || !d));
}

/**
 * 모임 인증·생성·참여에서 성별·생년을 요구할지.
 * - `google_sns` + 미입력
 * - 이메일 PK(`app_user_id`에 `@`)인데 `phone_otp`가 아니고 가입 경로가 비어 있거나 미동기화된 경우(구글 간편가입 등)
 */
export function meetingDemographicsIncomplete(
  p: UserProfile | null | undefined,
  appUserId?: string | null,
): boolean {
  if (!p || p.isWithdrawn === true) return false;
  if (!isDemographicsIncomplete(p)) return false;
  // phone_otp: 생년·성별 미입력이면 SNS와 동일하게 보완 대상(인증 시트·탭 게이트).
  if (p.signupProvider === 'phone_otp') return true;
  if (p.signupProvider === 'google_sns') return true;
  const id = appUserId?.trim() ?? '';
  return id.includes('@');
}

/** SNS(Google) 간편 가입자가 성별·생년을 모두 채우기 전인지 — 레거시 호환·명시적 구글만 */
export function isGoogleSnsDemographicsIncomplete(p: UserProfile | null | undefined): boolean {
  return p?.signupProvider === 'google_sns' && isDemographicsIncomplete(p);
}

/** 모임 참여 제한용: 전화번호 인증 완료 사용자 여부 */
export function isUserPhoneVerified(p: UserProfile | null | undefined): boolean {
  if (!p || p.isWithdrawn === true) return false;
  // OTP 가입/로그인은 Firebase Phone Auth를 거치므로 기본적으로 verified로 취급합니다.
  if (p.signupProvider === 'phone_otp') return true;
  return p.phoneVerifiedAt != null;
}

/** Firestore `Timestamp` 등을 `Date`로 변환(실패 시 null). */
export function firestoreTimestampLikeToDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === 'object' && 'toDate' in v && typeof (v as { toDate?: unknown }).toDate === 'function') {
    try {
      const d = (v as { toDate: () => Date }).toDate();
      return d instanceof Date && Number.isFinite(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function hasTermsAgreementRecorded(p: UserProfile | null | undefined): boolean {
  if (!p || p.isWithdrawn === true) return false;
  return p.termsAgreedAt != null;
}

/** 모임 이용 동의·(옵션)전화 인증·(간편가입 등) 성별·생년까지 갖춘 경우 — `MEETING_PHONE_VERIFICATION_UI_ENABLED`가 false면 전화 인증을 생략합니다. */
export function isMeetingServiceComplianceComplete(
  p: UserProfile | null | undefined,
  appUserId?: string | null,
): boolean {
  if (!p || p.isWithdrawn === true) return false;
  if (MEETING_PHONE_VERIFICATION_UI_ENABLED && !isUserPhoneVerified(p)) return false;
  if (!hasTermsAgreementRecorded(p)) return false;
  if (meetingDemographicsIncomplete(p, appUserId)) return false;
  return true;
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
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }
  // Supabase profiles.phone(E.164)로 app_user_id를 역조회합니다.
  // 스키마 캐시 지연/일시적인 PostgREST 오류로 빈 값이 돌아오면 잘못된 PK(전화 PK)로 폴백하면서
  // "저장은 됐는데 다시 로그인하면 정보가 사라진 것처럼 보이는" 문제가 생길 수 있어 재시도합니다.
  let docId = '';
  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { data, error } = await supabase.rpc('resolve_app_user_id_from_phone_e164', { p_phone: phone });
    if (!error) {
      docId = typeof data === 'string' ? data.trim() : '';
      if (docId) break;
      lastMessage = 'resolve_app_user_id_from_phone_e164 returned empty';
      continue;
    }
    const msg = error.message?.trim() || 'resolve_app_user_id_from_phone_e164 failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    lastMessage = msg;
    const retryable = isPostgrestSchemaCacheOrMissingRpcError(msg, code);
    if (!retryable) {
      throw new Error(msg);
    }
  }
  if (!docId) {
    // 역조회가 실패하면 null로 처리해서 호출부가 "전화 PK 폴백"으로 새 프로필을 만들지 않게 합니다.
    return null;
  }
  if (!docId) return null;
  const profile = await getUserProfile(docId);
  if (!profile) return null;
  return { docId, profile };
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
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }
  // 레거시 OTP(전화 PK) 재가입 최소 동작: 해당 PK로 Supabase 행을 재활성화합니다.
  await rpcEnsureProfileMinimalWithRetry(phone);
  await rpcUpsertProfilePayloadWithRetry(
    phone,
    profilePatchToSupabaseJsonb({
      phone,
      // 탈퇴 후 재가입 시, 예전 인증 완료 시각이 남아 "이미 인증됨"으로 보이지 않게 초기화합니다.
      phoneVerifiedAt: null,
      isWithdrawn: false,
      withdrawnAt: null,
    }),
  );
  return phone;
}

function supabaseProfileJsonToFirestoreShape(row: Record<string, unknown>): Record<string, unknown> {
  const sp = typeof row.signup_provider === 'string' ? row.signup_provider.trim().toLowerCase() : '';
  return {
    nickname: row.nickname,
    photoUrl: row.photo_url,
    phone: row.phone,
    phoneVerifiedAt: row.phone_verified_at ?? null,
    email: row.email,
    displayName: row.display_name,
    termsAgreedAt: row.terms_agreed_at ?? null,
    gender: row.gender,
    ageBand: row.age_band,
    birthYear: row.birth_year,
    birthMonth: row.birth_month,
    birthDay: row.birth_day,
    gLevel: row.g_level,
    gXp: row.g_xp,
    gTrust: row.g_trust,
    gDna: row.g_dna,
    meetingCount: row.meeting_count,
    rankingPoints: row.ranking_points,
    isWithdrawn: row.is_withdrawn === true,
    status: row.is_withdrawn === true ? 'WITHDRAWN' : 'ACTIVE',
    signupProvider: sp === 'google_sns' || sp === 'phone_otp' ? sp : null,
    fcmToken:
      typeof row.fcm_token === 'string' && row.fcm_token.trim() !== '' ? row.fcm_token.trim() : null,
    fcmPlatform:
      row.fcm_platform === 'ios' || row.fcm_platform === 'android' ? row.fcm_platform : null,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}

function tsToIsoOrNull(v: unknown): string | null {
  const d = firestoreTimestampLikeToDate(v);
  if (d && Number.isFinite(d.getTime())) return d.toISOString();
  // Firestore `serverTimestamp()` sentinel(클라이언트 사이드) → Supabase에는 즉시값이 필요하므로 now로 고정합니다.
  if (v && typeof v === 'object' && '_methodName' in (v as object)) {
    const m = String((v as { _methodName?: unknown })._methodName ?? '').trim().toLowerCase();
    if (m === 'servertimestamp') return new Date().toISOString();
  }
  return null;
}

function profilePatchToSupabaseJsonb(patch: {
  nickname?: string;
  photoUrl?: string | null;
  gender?: string | null;
  ageBand?: string | null;
  birthYear?: number | null;
  birthMonth?: number | null;
  birthDay?: number | null;
  birthDate?: unknown | null;
  phone?: string | null;
  phoneVerifiedAt?: unknown | null;
  termsAgreedAt?: unknown | null;
  rankingPoints?: number | null;
  email?: string | null;
  displayName?: string | null;
  /** 디바이스별 최신 FCM 토큰 */
  fcmToken?: string | null;
  fcmPlatform?: 'ios' | 'android' | null;
  signupProvider?: 'google_sns' | 'phone_otp' | null;
  isWithdrawn?: boolean | null;
  withdrawnAt?: unknown | null;
  /** `upsert_profile_payload`에 `metadata_patch`로 병합(기존 metadata와 ||) */
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (patch.nickname !== undefined) {
    const n = patch.nickname.trim();
    if (!n) throw new Error('닉네임을 입력해 주세요.');
    fields.nickname = n;
  }
  if (patch.photoUrl !== undefined) {
    fields.photo_url =
      patch.photoUrl === null || String(patch.photoUrl).trim() === '' ? null : String(patch.photoUrl).trim();
  }
  if (patch.gender !== undefined) {
    fields.gender = patch.gender && String(patch.gender).trim() ? String(patch.gender).trim() : null;
  }
  if (patch.ageBand !== undefined) {
    fields.age_band = patch.ageBand && String(patch.ageBand).trim() ? String(patch.ageBand).trim() : null;
  }
  // 생년월일: 분필드가 모두 있으면 우선(구글 가입 등 로컬 달력과 일치). birthDate만 있으면 로컬 달력으로 변환.
  // 기존 UTC만 쓰면 `Timestamp.fromDate(new Date(y,m-1,d))`와 하루 어긋날 수 있고, birthDate 파싱 실패 시 분필드가 무시되던 문제가 있었음.
  if (
    patch.birthDate !== undefined ||
    patch.birthYear !== undefined ||
    patch.birthMonth !== undefined ||
    patch.birthDay !== undefined
  ) {
    let y: number | null = null;
    let mo: number | null = null;
    let da: number | null = null;
    const yE = patch.birthYear;
    const mE = patch.birthMonth;
    const dE = patch.birthDay;
    if (
      yE != null &&
      Number.isFinite(yE) &&
      mE != null &&
      Number.isFinite(mE) &&
      dE != null &&
      Number.isFinite(dE)
    ) {
      y = Math.trunc(yE);
      mo = Math.trunc(mE);
      da = Math.trunc(dE);
    } else {
      const d = firestoreTimestampLikeToDate(patch.birthDate);
      if (d && Number.isFinite(d.getTime())) {
        y = d.getFullYear();
        mo = d.getMonth() + 1;
        da = d.getDate();
      }
    }
    if (y != null && mo != null && da != null) {
      fields.birth_year = y;
      fields.birth_month = mo;
      fields.birth_day = da;
    }
  }
  if (patch.phone !== undefined) {
    fields.phone = patch.phone && String(patch.phone).trim() ? String(patch.phone).trim() : null;
  }
  if (patch.phoneVerifiedAt !== undefined) {
    const iso = tsToIsoOrNull(patch.phoneVerifiedAt);
    if (iso != null) fields.phone_verified_at = iso;
    else if (patch.phoneVerifiedAt === null) fields.phone_verified_at = null;
  }
  if (patch.termsAgreedAt !== undefined) {
    const iso = tsToIsoOrNull(patch.termsAgreedAt);
    if (iso != null) fields.terms_agreed_at = iso;
    else if (patch.termsAgreedAt === null) fields.terms_agreed_at = null;
  }
  if (patch.rankingPoints !== undefined) {
    const n = patch.rankingPoints;
    fields.ranking_points = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null;
  }
  if (patch.email !== undefined) {
    fields.email = patch.email && String(patch.email).trim() ? String(patch.email).trim() : null;
  }
  if (patch.displayName !== undefined) {
    fields.display_name =
      patch.displayName && String(patch.displayName).trim() ? String(patch.displayName).trim() : null;
  }
  if (patch.fcmToken !== undefined) {
    const t = patch.fcmToken && String(patch.fcmToken).trim() ? String(patch.fcmToken).trim() : '';
    // 토큰이 없으면(falsy/빈 문자열) payload에 fcm_token 자체를 포함하지 않습니다.
    // (기존 DB 값이 null로 덮이는 것을 방지)
    if (t) fields.fcm_token = t;
  }
  if (patch.fcmPlatform !== undefined) {
    if (patch.fcmPlatform === null) {
      fields.fcm_platform = null;
    } else if (patch.fcmPlatform === 'ios' || patch.fcmPlatform === 'android') {
      fields.fcm_platform = patch.fcmPlatform;
    }
  }
  if (patch.signupProvider !== undefined) {
    const sp = patch.signupProvider;
    fields.signup_provider =
      sp === 'google_sns' || sp === 'phone_otp' ? sp : sp == null ? null : String(sp).trim() || null;
  }
  if (patch.isWithdrawn !== undefined) {
    fields.is_withdrawn = patch.isWithdrawn === true;
  }
  if (patch.withdrawnAt !== undefined) {
    const iso = tsToIsoOrNull(patch.withdrawnAt);
    if (iso != null) fields.withdrawn_at = iso;
    else if (patch.withdrawnAt === null) fields.withdrawn_at = null;
  }
  if (patch.metadata !== undefined && patch.metadata != null) {
    const keys = Object.keys(patch.metadata);
    if (keys.length > 0) fields.metadata_patch = patch.metadata;
  }
  return fields;
}

function isPostgrestSchemaCacheOrMissingRpcError(message: string, code?: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('schema cache')) return true;
  if (m.includes('could not find the function')) return true;
  // PostgREST: 함수를 스키마 캐시에서 찾지 못함
  if (code === 'PGRST202' || code === '42883') return true;
  return false;
}

const RPC_SCHEMA_CACHE_RETRY_WAITS_MS = [0, 800, 2500, 6000, 14000] as const;

function parseProfileRpcPayload(data: unknown): UserProfile | null {
  if (data == null) return null;
  const row = data as Record<string, unknown>;
  if (typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === 0) return null;
  return mapUserDoc(supabaseProfileJsonToFirestoreShape(row));
}

type SupabasePublicProfileFetch =
  | { ok: true; profile: UserProfile }
  | { ok: false; message: string };

/** `get_profile_public_by_app_user_id` — 스키마 캐시 지연·빈 응답 시 재시도 */
async function fetchUserProfileFromSupabaseRpcDetailed(appUserId: string): Promise<SupabasePublicProfileFetch> {
  const id = appUserId.trim();
  if (!id) return { ok: false, message: '사용자 ID가 없습니다.' };
  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { data, error } = await supabase.rpc('get_profile_public_by_app_user_id', {
      p_app_user_id: id,
    });
    if (!error) {
      const profile = parseProfileRpcPayload(data);
      if (profile) return { ok: true, profile };
      lastMessage =
        '프로필을 불러올 수 없습니다. Supabase profiles 행이 없거나 공개 조회 RPC(get_profile_public_by_app_user_id) 결과가 비어 있습니다.';
      continue;
    }
    const msg = error.message?.trim() || 'get_profile_public_by_app_user_id failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    lastMessage = msg;
    const retryable = isPostgrestSchemaCacheOrMissingRpcError(msg, code);
    if (!retryable) {
      return { ok: false, message: msg };
    }
  }
  return { ok: false, message: lastMessage || '프로필을 불러올 수 없습니다.' };
}

export async function getUserProfile(phoneUserId: string): Promise<UserProfile | null> {
  const id = phoneUserId.trim();
  if (!id) return null;
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }
  const r = await fetchUserProfileFromSupabaseRpcDetailed(id);
  return r.ok ? r.profile : null;
}

/** `ensure_profile_minimal` — PostgREST 스키마 캐시 지연 시 여러 번 재시도 */
async function rpcEnsureProfileMinimalWithRetry(id: string): Promise<void> {
  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { error } = await supabase.rpc('ensure_profile_minimal', { p_app_user_id: id });
    if (!error) return;
    lastMessage = error.message?.trim() || 'ensure_profile_minimal failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    const retryable = isPostgrestSchemaCacheOrMissingRpcError(lastMessage, code);
    if (!retryable || i === RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length - 1) {
      throw new Error(lastMessage);
    }
  }
}

/**
 * RPC `p_fields`에 빈 `fcm_token` 문자열이 들어가면(직렬화 버그 등) DB에서 기존 토큰이 NULL로 덮일 수 있어 제거합니다.
 * `fcm_token: null`(JSON null)만 탈퇴 등 **명시적 비우기**로 유지합니다.
 */
function sanitizeFcmTokenFieldForRpc(fields: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(fields, 'fcm_token')) return;
  const v = fields.fcm_token;
  if (v === null) return;
  if (v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')) {
    delete fields.fcm_token;
  }
}

/** `upsert_profile_payload` — 탈퇴·프로필 수정, 스키마 캐시 지연 시 재시도 */
async function rpcUpsertProfilePayloadWithRetry(id: string, fields: Record<string, unknown>): Promise<void> {
  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const payload = { ...fields };
    sanitizeFcmTokenFieldForRpc(payload);
    const { error } = await supabase.rpc('upsert_profile_payload', {
      p_app_user_id: id,
      p_fields: payload,
    });
    if (!error) return;
    lastMessage = error.message?.trim() || 'upsert_profile_payload failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    const retryable = isPostgrestSchemaCacheOrMissingRpcError(lastMessage, code);
    if (!retryable || i === RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length - 1) {
      throw new Error(lastMessage);
    }
  }
}

/**
 * 로그인 직후 등: 프로필이 없으면 랜덤 닉네임으로 생성합니다.
 */
export async function ensureUserProfile(phoneUserId: string): Promise<UserProfile> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }
  await rpcEnsureProfileMinimalWithRetry(id);
  const r = await fetchUserProfileFromSupabaseRpcDetailed(id);
  if (!r.ok) throw new Error(r.message);
  return r.profile;
}

/** 구글 가입 직후: Supabase profiles에 계정 정보를 병합(신규면 생성). */
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
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }

  await rpcEnsureProfileMinimalWithRetry(id);
  await rpcUpsertProfilePayloadWithRetry(
    id,
    profilePatchToSupabaseJsonb({
      nickname: patch.nickname,
      photoUrl: patch.photoUrl,
      phone: patch.phone ?? undefined,
      phoneVerifiedAt: patch.phoneVerifiedAt ?? undefined,
      email: patch.email ?? undefined,
      displayName: patch.displayName ?? undefined,
      // undefined면 기존 값 유지(로그인/가입 플로우에서 People API 값이 없다고 기존 성별을 지우면 안 됨)
      gender: patch.gender ?? undefined,
      ageBand: patch.ageBand ?? undefined,
      birthDate: patch.birthDate ?? undefined,
      birthYear: patch.birthYear ?? undefined,
      birthMonth: patch.birthMonth ?? undefined,
      birthDay: patch.birthDay ?? undefined,
      signupProvider: patch.signupProvider ?? undefined,
      metadata: patch.metadata ?? undefined,
      // 재가입/복구 케이스: withdrawn이면 재활성화
      isWithdrawn: false,
      withdrawnAt: null,
    }),
  );

  const r = await fetchUserProfileFromSupabaseRpcDetailed(id);
  if (!r.ok) throw new Error(r.message);
  return r.profile;
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
    fcmPlatform?: 'ios' | 'android' | null;
    lastLoginAt?: unknown | null;
    rankingPoints?: number | null;
    badges?: string[] | null;
    phone?: string | null;
    phoneVerifiedAt?: unknown | null;
    termsAgreedAt?: unknown | null;
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
    signupProvider?: 'google_sns' | 'phone_otp' | null;
    /** `false` + `withdrawnAt: null` 이면 탈퇴 행 재활성화(재가입 등) */
    isWithdrawn?: boolean | null;
    withdrawnAt?: unknown | null;
  },
): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }
  const mapped = await getUserProfile(id);
  if (mapped?.isWithdrawn === true && patch.isWithdrawn !== false) {
    throw new Error('탈퇴 처리된 계정은 프로필을 수정할 수 없습니다.');
  }
  const fields = profilePatchToSupabaseJsonb(patch);
  if (Object.keys(fields).length === 0) return;
  await rpcUpsertProfilePayloadWithRetry(id, fields);
  return;
}

/** 탈퇴: 채팅·투표·모임 참여 기록은 유지하고, `users` 문서의 식별 정보를 비웁니다. */
export async function withdrawAnonymizeUserProfile(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  if (profilesSource() !== 'supabase') {
    throw new Error('[profiles] Firestore `users`는 더 이상 사용하지 않습니다.');
  }
  await rpcUpsertProfilePayloadWithRetry(id, {
    is_withdrawn: true,
    nickname: WITHDRAWN_NICKNAME,
    withdrawn_at: new Date().toISOString(),

    // 개인정보/인증/동의/프로필성 정보는 모두 null 처리합니다.
    photo_url: null,
    phone: null,
    phone_verified_at: null,
    email: null,
    display_name: null,
    fcm_token: null,
    fcm_platform: null,
    terms_agreed_at: null,
    gender: null,
    age_band: null,
    birth_year: null,
    birth_month: null,
    birth_day: null,
    signup_provider: null,
    // private 계정 플래그는 운영상 의미가 없으므로 기본값으로 되돌립니다.
    is_private: false,
    metadata: {},
  });
}

/**
 * 구글/UID 기반 로그인 사용자 탈퇴:
 * `users` 문서의 `firebaseUid`로 역조회 후 익명화합니다.
 * 문서가 없으면 서버 익명화는 no-op으로 통과합니다.
 */
export async function withdrawAnonymizeUserProfileByFirebaseUid(firebaseUid: string): Promise<void> {
  const uid = firebaseUid.trim();
  if (!uid) throw new Error('Firebase UID가 없습니다.');
  // 구글/UID 기반 로그인 사용자는 앱 전반(모임 createdBy 등)에서 uid 자체를 사용자 PK로 사용합니다.
  await withdrawAnonymizeUserProfile(uid);
}

/** 약관 동의 기록(서버 시각 기준). */
export async function recordTermsAgreement(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  await rpcUpsertProfilePayloadWithRetry(id, profilePatchToSupabaseJsonb({ termsAgreedAt: serverTimestamp() }));
}

/** Firestore `users/{사용자 PK}` 문서를 삭제합니다(탈퇴 마지막 단계). */
export async function deleteUserProfileDocument(phoneUserId: string): Promise<void> {
  const id = phoneUserId.trim();
  if (!id) throw new Error('사용자 ID가 없습니다.');
  throw new Error('[profiles] Firestore `users` 문서 삭제는 더 이상 지원하지 않습니다.');
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
