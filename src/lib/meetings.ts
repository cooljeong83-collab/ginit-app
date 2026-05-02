/**
 * Firestore `meetings` 컬렉션.
 *
 * `createdBy`는 **앱 사용자 PK** 문자열로 저장됩니다. (신규: 정규화 이메일, 레거시: +8210… 전화 PK)
 *
 * 콘솔 규칙 예시(인증만 요구하는 단순형):
 *   match /meetings/{id} {
 *     allow read: if request.auth != null;
 *     allow create: if request.auth != null;
 *     allow update, delete: if request.auth != null && request.auth.uid == resource.data.createdBy;
 *   }
 * → 위 update/delete 규칙은 UID 기준이므로, 전화 PK만 쓰려면 예를 들어
 *   `resource.data.createdBy == request.auth.token.phone_number` 처럼
 *   Custom Claim을 두거나, 별도 `authorUid` 필드와 함께 정책을 조정해야 합니다.
 */
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { feedRegionNormFromAddressHaystack } from './feed-display-location';
import { stripUndefinedDeep, toFiniteInt, toJsonSafeFirestorePreview } from './firestore-utils';
import { getFirebaseFirestore } from './firebase';
import { ginitNotifyDbg } from './ginit-notify-debug';
import { ledgerWritesToSupabase } from './hybrid-data-source';
import {
  isLedgerMeetingId,
  ledgerGetMeetingDocOutcome,
  ledgerMeetingCreate,
  ledgerMeetingDelete,
  ledgerMeetingPutRawDoc,
  ledgerTryLoadMeetingDoc,
} from './meetings-ledger';
import {
  notifyMeetingJoinRequestApplicantDecisionFireAndForget,
  notifyMeetingNewHostAssignedFireAndForget,
  notifyMeetingHostParticipantEventFireAndForget,
  notifyMeetingParticipantRemovedByHostFireAndForget,
  notifyMeetingParticipantsOfHostActionFireAndForget,
} from './meeting-host-push-notify';
import type { MeetingExtraData, SelectedMovieExtra } from './meeting-extra-data';
import {
  fmtDateYmd,
  fmtTimeHm,
  getDateCandidateScheduleInstant,
  primaryScheduleFromDateCandidate,
  validateDateCandidatesForSave,
  validateNewDateProposalCandidate,
  validatePrimaryScheduleForSave,
} from './date-candidate';
import {
  assertNoConfirmedScheduleOverlapHybrid,
  assertProposedStartsOverlapHybrid,
  getScheduleOverlapBufferHours,
} from './meeting-schedule-overlap';
import type { DateCandidate } from './meeting-place-bridge';
import { getPolicyNumeric } from './app-policies-store';
import { normalizeParticipantId } from './app-user-id';
import {
  effectiveGLevel,
  effectiveGTrust,
  GINIT_HIGH_TRUST_HOST_MIN,
  isHighTrustPublicMeeting,
  isUserTrustRestricted,
} from './ginit-trust';
import { supabase } from './supabase';
import { getUserProfile, isMeetingServiceComplianceComplete, type UserProfile } from './user-profile';

export const MEETINGS_COLLECTION = 'meetings';

/** `GlassDualCapacityWheel` 의 무제한 정원 값(999)과 동일해야 합니다. */
export const MEETING_CAPACITY_UNLIMITED = 999;
/** 최소·최대(참가) 인원 피커 하한(명). UI `PARTICIPANT_COUNT_MIN` 과 동일해야 합니다. */
export const MEETING_PARTICIPANT_MIN = 2;

/** 후보별 누적 투표 수(칩 id 키). 참여 시 선택한 항목마다 +1 */
export type MeetingVoteTallies = {
  dates?: Record<string, number>;
  places?: Record<string, number>;
  movies?: Record<string, number>;
};

/** 참여자별 마지막으로 반영된 투표(칩 id). 탈퇴·수정 시 집계에 사용 */
export type ParticipantVoteSnapshot = {
  userId: string;
  dateChipIds: string[];
  placeChipIds: string[];
  movieChipIds: string[];
};

/** 공개 모임 + 호스트 승인 방식일 때, 아직 참여자 목록에 오르기 전 신청 큐 */
export type MeetingJoinRequest = {
  userId: string;
  dateChipIds: string[];
  placeChipIds: string[];
  movieChipIds: string[];
  message?: string | null;
  /** ISO 8601 */
  requestedAt: string;
};

export const MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN = 200;

export type Meeting = {
  id: string;
  title: string;
  /** 장소명(표시용). 기존 데이터 호환 */
  location: string;
  description: string;
  capacity: number;
  /** 최소 인원(듀얼 휠). 없으면 기존 문서와 동일하게 `capacity`만 사용 */
  minParticipants?: number | null;
  /** Firestore 서버 타임스탬프 */
  createdAt?: Timestamp | null;
  createdBy?: string | null;
  imageUrl?: string | null;
  categoryId?: string | null;
  categoryLabel?: string | null;
  isPublic?: boolean | null;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
  scheduledAt?: Timestamp | null;
  placeName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** 카테고리 특화 폼(영화·메뉴·운동 강도 등) */
  extraData?: MeetingExtraData | Record<string, unknown> | null;
  /** 등록 시 저장된 일정·장소 후보(상세·투표 UI용) */
  dateCandidates?: DateCandidate[] | null;
  placeCandidates?: Array<{
    id: string;
    placeName: string;
    address: string;
    latitude: number;
    longitude: number;
    naverPlaceLink?: string | null;
  }> | null;
  /** 참여 확정 사용자 전화 PK(정규화). 주선자는 모임 생성 시 포함하는 것을 권장 */
  participantIds?: string[] | null;
  voteTallies?: MeetingVoteTallies | null;
  participantVoteLog?: ParticipantVoteSnapshot[] | null;
  /** 모임 주관자가 일정 확정 시 true */
  scheduleConfirmed?: boolean | null;
  /** 확정 시 선택된 일시·장소·영화 칩 id (집계·동점 처리 결과) */
  confirmedDateChipId?: string | null;
  confirmedPlaceChipId?: string | null;
  confirmedMovieChipId?: string | null;
  /** 공개 모임 상세 조건(필터/추천/승인 정책) */
  meetingConfig?: PublicMeetingDetailsConfig | Record<string, unknown> | null;
  /**
   * 채팅 읽음 상태(참여자별). 서버 스냅샷 기반으로 채팅 화면에서 "안 읽은 사람 수" 표시 등에 사용합니다.
   * - 키는 app user id(정규화 PK)
   */
  chatReadAtBy?: Record<string, Timestamp | null> | null;
  chatReadMessageIdBy?: Record<string, string> | null;
  /** `meetingConfig.approvalType === 'HOST_APPROVAL'` 일 때만 사용 */
  joinRequests?: MeetingJoinRequest[] | null;
  /** 호스트 강제 퇴장된 app_user_id(정규화 PK). 재참여·재신청 차단용 */
  kickedParticipantIds?: string[] | null;
};

/**
 * 피드·목록 제목 등: `categoryLabel`가 비어 있으면 `categoryId`로 카테고리 목록에서 표시명을 찾습니다.
 */
export function meetingCategoryDisplayLabel(
  m: Pick<Meeting, 'categoryId' | 'categoryLabel'>,
  categories?: readonly { id: string; label: string }[] | null | undefined,
): string | null {
  const direct = (m.categoryLabel ?? '').trim();
  if (direct) return direct;
  const id = (m.categoryId ?? '').trim();
  if (!id || !categories?.length) return null;
  const hit = categories.find((c) => String(c.id).trim() === id);
  const lab = hit?.label?.trim();
  return lab && lab.length > 0 ? lab : null;
}

export type PublicMeetingAgeLimit = 'TWENTIES' | 'THIRTIES' | 'FORTY_PLUS' | 'NONE';
export type PublicMeetingGenderRatio = 'ALL' | 'SAME_GENDER_ONLY' | 'HALF_HALF';
export type PublicMeetingSettlement = 'DUTCH' | 'HOST_PAYS' | 'INDIVIDUAL' | 'MEMBERSHIP_FEE';
export type PublicMeetingApprovalType = 'INSTANT' | 'HOST_APPROVAL';

/** `genderRatio === 'SAME_GENDER_ONLY'`일 때 주최자 성별(등록 시 스냅샷). 레거시 문서에는 없을 수 있음. */
export type PublicMeetingHostGenderSnapshot = 'male' | 'female';

export type PublicMeetingDetailsConfig = {
  /** 모집 연령대(멀티 선택). NONE이 있으면 제한 없음으로 해석 */
  ageLimit: PublicMeetingAgeLimit[];
  genderRatio: PublicMeetingGenderRatio;
  /** 동성만 모집 시 주최자 성별(피드·상세 표시). 프로필 `gender`에서 등록 시 저장 */
  hostGenderSnapshot?: PublicMeetingHostGenderSnapshot | null;
  settlement: PublicMeetingSettlement;
  /** `settlement === 'MEMBERSHIP_FEE'` 일 때 참가 회비(원, 정수) */
  membershipFeeWon?: number | null;
  /** 참가 자격: 최소 gLevel/gTrust */
  minGLevel: number;
  minGTrust?: number | null;
  approvalType: PublicMeetingApprovalType;
  /** approvalType=HOST_APPROVAL 일 때 신청 메시지 받기 */
  requestMessageEnabled?: boolean | null;
};

/** 모임 생성 화면·기본 정보 수정 등에서 공개 상세 조건 초기값으로 공통 사용 */
export const DEFAULT_PUBLIC_MEETING_DETAILS_CONFIG: PublicMeetingDetailsConfig = {
  ageLimit: ['NONE'],
  genderRatio: 'ALL',
  settlement: 'DUTCH',
  minGLevel: 1,
  minGTrust: null,
  approvalType: 'INSTANT',
  requestMessageEnabled: null,
};

function isPublicMeetingAgeLimit(x: unknown): x is PublicMeetingAgeLimit {
  return x === 'TWENTIES' || x === 'THIRTIES' || x === 'FORTY_PLUS' || x === 'NONE';
}

function isPublicMeetingGenderRatio(x: unknown): x is PublicMeetingGenderRatio {
  return x === 'ALL' || x === 'SAME_GENDER_ONLY' || x === 'HALF_HALF';
}

function isPublicMeetingSettlement(x: unknown): x is PublicMeetingSettlement {
  return x === 'DUTCH' || x === 'HOST_PAYS' || x === 'INDIVIDUAL' || x === 'MEMBERSHIP_FEE';
}

function isPublicMeetingApprovalType(x: unknown): x is PublicMeetingApprovalType {
  return x === 'INSTANT' || x === 'HOST_APPROVAL';
}

function isPublicMeetingHostGenderSnapshot(x: unknown): x is PublicMeetingHostGenderSnapshot {
  return x === 'male' || x === 'female';
}

/** 프로필·레거시 문자열 → 스냅샷. 알 수 없으면 null */
export function normalizeProfileGenderToHostSnapshot(gender: string | null | undefined): PublicMeetingHostGenderSnapshot | null {
  const raw = (gender ?? '').trim();
  if (!raw) return null;
  const u = raw.toUpperCase();
  if (u === 'MALE' || u === 'M' || u === '남' || u === '남성') return 'male';
  if (u === 'FEMALE' || u === 'F' || u === '여' || u === '여성') return 'female';
  const l = raw.toLowerCase();
  if (l === 'male') return 'male';
  if (l === 'female') return 'female';
  return null;
}

/**
 * Firestore `meetingConfig` → UI용. `null`이면 필드가 없거나 형식이 맞지 않음.
 */
export function parsePublicMeetingDetailsConfig(raw: unknown): PublicMeetingDetailsConfig | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  let ageLimit: PublicMeetingAgeLimit[] = ['NONE'];
  if (Array.isArray(o.ageLimit)) {
    const xs = o.ageLimit.filter(isPublicMeetingAgeLimit);
    if (xs.length > 0) ageLimit = xs;
  }

  const genderRatio = isPublicMeetingGenderRatio(o.genderRatio) ? o.genderRatio : 'ALL';
  const settlement = isPublicMeetingSettlement(o.settlement) ? o.settlement : 'DUTCH';
  let membershipFeeWon: number | null | undefined;
  if (settlement === 'MEMBERSHIP_FEE') {
    const raw = toFiniteInt(o.membershipFeeWon, NaN);
    membershipFeeWon =
      Number.isFinite(raw) && raw >= 0 ? Math.min(100_000, Math.trunc(raw)) : null;
  }
  const minGLevel = Math.max(1, Math.min(50, toFiniteInt(o.minGLevel, 1)));
  let minGTrust: number | null = null;
  if (typeof o.minGTrust === 'number' && Number.isFinite(o.minGTrust)) {
    minGTrust = Math.max(0, Math.min(100, Math.trunc(o.minGTrust)));
  }
  const approvalType = isPublicMeetingApprovalType(o.approvalType) ? o.approvalType : 'INSTANT';
  const requestMessageEnabled =
    o.requestMessageEnabled === true ? true : o.requestMessageEnabled === false ? false : null;

  let hostGenderSnapshot: PublicMeetingHostGenderSnapshot | null = null;
  let hasHostGenderKey = false;
  if (Object.prototype.hasOwnProperty.call(o, 'hostGenderSnapshot')) {
    hasHostGenderKey = true;
    const h = o.hostGenderSnapshot;
    if (h == null) hostGenderSnapshot = null;
    else if (isPublicMeetingHostGenderSnapshot(h)) hostGenderSnapshot = h;
    else if (typeof h === 'string') hostGenderSnapshot = normalizeProfileGenderToHostSnapshot(h);
    else hostGenderSnapshot = null;
  }

  return {
    ageLimit,
    genderRatio,
    settlement,
    ...(settlement === 'MEMBERSHIP_FEE' ? { membershipFeeWon: membershipFeeWon ?? null } : {}),
    minGLevel,
    minGTrust,
    approvalType,
    requestMessageEnabled,
    ...(hasHostGenderKey ? { hostGenderSnapshot } : {}),
  };
}

/**
 * 공개 모임 참가 자격 (`joinMeeting` 게이트).
 * @returns 막힐 때 사용자에게 보여줄 한국어 메시지, 통과 시 null
 */
export function getJoinGamificationBlockReason(
  profile: UserProfile | null | undefined,
  meetingData: Record<string, unknown>,
): string | null {
  if (isUserTrustRestricted(profile)) {
    return '신뢰도 정책에 따라 일시적으로 모임 참여가 제한된 계정이에요. 고객센터 또는 안내를 확인해 주세요.';
  }

  const trust = effectiveGTrust(profile);
  const globalMinTrust = Math.trunc(getPolicyNumeric('trust', 'min_join_score', 70));
  if (trust < globalMinTrust) {
    return `서비스 운영 정책상 gTrust ${globalMinTrust}점 이상만 모임에 참여할 수 있어요.`;
  }

  if (meetingData.isPublic !== true) return null;

  const cfg = parsePublicMeetingDetailsConfig(meetingData.meetingConfig);
  if (!cfg) return null;

  const gLevel = effectiveGLevel(profile);
  if (gLevel < cfg.minGLevel) {
    return `이 모임은 최소 Lv ${cfg.minGLevel} 이상만 참여할 수 있어요.`;
  }

  const minT = cfg.minGTrust;
  if (typeof minT === 'number' && Number.isFinite(minT)) {
    const hostMin = Math.trunc(minT);
    const baseNeed = isHighTrustPublicMeeting(cfg) ? Math.max(GINIT_HIGH_TRUST_HOST_MIN, hostMin) : hostMin;
    const needFinal = Math.max(globalMinTrust, baseNeed);
    if (trust < needFinal) {
      return isHighTrustPublicMeeting(cfg)
        ? `이 모임은 신뢰도 높은 모임으로, gTrust ${needFinal}점 이상만 참여할 수 있어요.`
        : `이 모임은 최소 gTrust ${needFinal}점 이상만 참여할 수 있어요.`;
    }
  }

  return null;
}

const AGE_SUMMARY_ORDER: PublicMeetingAgeLimit[] = ['TWENTIES', 'THIRTIES', 'FORTY_PLUS'];

const AGE_SUMMARY_LABEL: Record<PublicMeetingAgeLimit, string> = {
  TWENTIES: '20대',
  THIRTIES: '30대',
  FORTY_PLUS: '40대 이상',
  NONE: '제한 없음',
};

/** 모임 상세 등 읽기 전용 한 줄 요약 */
export function formatPublicMeetingAgeSummary(ageLimit: PublicMeetingAgeLimit[]): string {
  const uniq = [...new Set(ageLimit ?? [])];
  if (uniq.length === 0 || uniq.includes('NONE')) return '제한 없음';
  return AGE_SUMMARY_ORDER.filter((k) => uniq.includes(k))
    .map((k) => AGE_SUMMARY_LABEL[k])
    .join(', ');
}

export function formatPublicMeetingGenderSummary(
  g: PublicMeetingGenderRatio,
  hostGenderSnapshot?: PublicMeetingHostGenderSnapshot | null,
): string {
  switch (g) {
    case 'SAME_GENDER_ONLY':
      if (hostGenderSnapshot === 'male') return '남자';
      if (hostGenderSnapshot === 'female') return '여자';
      return '동성만';
    case 'HALF_HALF':
      return '남녀 반반';
    case 'ALL':
    default:
      return '모두';
  }
}

export function formatPublicMeetingSettlementSummary(
  s: PublicMeetingSettlement,
  membershipFeeWon?: number | null,
): string {
  switch (s) {
    case 'HOST_PAYS':
      return '호스트 지불';
    case 'INDIVIDUAL':
      return '개별 계산';
    case 'MEMBERSHIP_FEE':
      return typeof membershipFeeWon === 'number' && membershipFeeWon > 0
        ? `회비 ${membershipFeeWon.toLocaleString('ko-KR')}원`
        : '회비';
    case 'DUTCH':
    default:
      return '1/N 더치페이';
  }
}

export function formatPublicMeetingApprovalSummary(a: PublicMeetingApprovalType): string {
  return a === 'HOST_APPROVAL' ? '호스트 승인' : '즉시 참여';
}

/** 표시용 참여 인원 수(주관자 + `participantIds`, 중복 제거). */
export function meetingParticipantCount(m: Meeting): number {
  const ids = m.participantIds ?? [];
  const set = new Set(ids.map((x) => normalizeParticipantId(String(x)) ?? String(x).trim()).filter(Boolean));
  const host = m.createdBy?.trim() ? normalizeParticipantId(m.createdBy) ?? m.createdBy.trim() : '';
  if (host) set.add(host);
  return Math.max(set.size, ids.length > 0 ? ids.length : host ? 1 : 0);
}

export function getFirestoreDb() {
  return getFirebaseFirestore();
}

type PlaceCandidateLike = {
  id: string;
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  naverPlaceLink?: string | null;
};

export type CreateMeetingInput = {
  title: string;
  /** 목록/호환용 장소 한 줄 표기(보통 placeName) */
  location: string;
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  description: string;
  capacity: number;
  minParticipants?: number | null;
  createdBy: string | null;
  categoryId: string;
  categoryLabel: string;
  isPublic: boolean;
  scheduleDate: string;
  scheduleTime: string;
  imageUrl?: string | null;
  placeCandidates?: PlaceCandidateLike[] | null;
  dateCandidates?: DateCandidate[] | null;
  extraData?: MeetingExtraData | null;
  meetingConfig?: PublicMeetingDetailsConfig | null;
};

import { parseScheduleToTimestamp } from './meeting-schedule-times';

export { parseScheduleToTimestamp };

function parseVoteIntMap(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n =
      typeof v === 'number' && Number.isFinite(v)
        ? Math.trunc(v)
        : typeof v === 'string'
          ? Number.parseInt(v, 10)
          : NaN;
    if (!Number.isFinite(n) || n < 0) continue;
    out[k] = Math.min(n, 1_000_000);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseVoteTalliesField(data: Record<string, unknown>): MeetingVoteTallies | null {
  const vt = data.voteTallies;
  if (!vt || typeof vt !== 'object' || Array.isArray(vt)) return null;
  const o = vt as Record<string, unknown>;
  const dates = parseVoteIntMap(o.dates);
  const places = parseVoteIntMap(o.places);
  const movies = parseVoteIntMap(o.movies);
  if (!dates && !places && !movies) return null;
  return { dates, places, movies };
}

function mergeTallyIncrement(
  prev: Record<string, number> | undefined,
  ids: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = { ...(prev ?? {}) };
  for (const raw of ids) {
    const k = raw.trim();
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function mergeTallyDecrement(
  prev: Record<string, number> | undefined,
  ids: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = { ...(prev ?? {}) };
  for (const raw of ids) {
    const k = raw.trim();
    if (!k) continue;
    const n = (out[k] ?? 0) - 1;
    if (n <= 0) delete out[k];
    else out[k] = n;
  }
  return out;
}

function parseParticipantVoteLog(data: Record<string, unknown>): ParticipantVoteSnapshot[] {
  const raw = data.participantVoteLog;
  if (!Array.isArray(raw)) return [];
  const out: ParticipantVoteSnapshot[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const userId = typeof o.userId === 'string' ? o.userId.trim() : '';
    if (!userId) continue;
    const dateChipIds = Array.isArray(o.dateChipIds)
      ? (o.dateChipIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const placeChipIds = Array.isArray(o.placeChipIds)
      ? (o.placeChipIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const movieChipIds = Array.isArray(o.movieChipIds)
      ? (o.movieChipIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    out.push({ userId, dateChipIds, placeChipIds, movieChipIds });
  }
  return out;
}

function parseJoinRequestsField(data: Record<string, unknown>): MeetingJoinRequest[] {
  const raw = data.joinRequests;
  if (!Array.isArray(raw)) return [];
  const out: MeetingJoinRequest[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const userId = typeof o.userId === 'string' ? o.userId.trim() : '';
    if (!userId) continue;
    const dateChipIds = Array.isArray(o.dateChipIds)
      ? (o.dateChipIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const placeChipIds = Array.isArray(o.placeChipIds)
      ? (o.placeChipIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const movieChipIds = Array.isArray(o.movieChipIds)
      ? (o.movieChipIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    const message =
      typeof o.message === 'string'
        ? o.message.trim().slice(0, MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN)
        : o.message === null
          ? null
          : undefined;
    const requestedAt = typeof o.requestedAt === 'string' && o.requestedAt.trim() ? o.requestedAt.trim() : '';
    if (!requestedAt) continue;
    out.push({
      userId,
      dateChipIds,
      placeChipIds,
      movieChipIds,
      ...(message !== undefined ? { message: message || null } : {}),
      requestedAt,
    });
  }
  return out;
}

function parseKickedParticipantIdsField(data: Record<string, unknown>): string[] {
  const raw = data.kickedParticipantIds;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
}

function assertParticipantNotKickedFromMeetingDoc(data: Record<string, unknown>, nsUid: string): void {
  const list = parseKickedParticipantIdsField(data);
  if (list.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid)) {
    throw new Error('이 모임에서는 호스트에 의해 퇴장되어 다시 참여하거나 신청할 수 없어요.');
  }
}

function mergeKickedParticipantIdsField(data: Record<string, unknown>, nsUidToAdd: string): string[] {
  const prev = parseKickedParticipantIdsField(data);
  const seen = new Set(prev.map((x) => normalizeParticipantId(x) ?? x.trim()));
  if (seen.has(nsUidToAdd)) return prev;
  return [...prev, nsUidToAdd];
}

/** 호스트 킥 등으로 이 모임에 다시 들어오거나 신청할 수 없는지(클라이언트 표시용) */
export function isUserKickedFromMeeting(meeting: Meeting, phoneUserId: string): boolean {
  const ns = normalizeParticipantId(phoneUserId.trim());
  if (!ns) return false;
  const list = meeting.kickedParticipantIds ?? [];
  return list.some((x) => (normalizeParticipantId(x) ?? String(x).trim()) === ns);
}

/** 공개 모임이 호스트 승인 참가 방식인지(문서 원시 기준) */
export function meetingDocRequiresHostApprovalJoin(data: Record<string, unknown>): boolean {
  if (data.isPublic !== true) return false;
  const cfg = parsePublicMeetingDetailsConfig(data.meetingConfig);
  return cfg?.approvalType === 'HOST_APPROVAL';
}

export function listMeetingJoinRequests(meeting: Meeting): MeetingJoinRequest[] {
  const xs = meeting.joinRequests ?? [];
  return Array.isArray(xs) ? xs : [];
}

export function findMeetingJoinRequestForUser(meeting: Meeting, phoneUserId: string): MeetingJoinRequest | null {
  const ns = normalizeParticipantId(phoneUserId.trim());
  if (!ns) return null;
  for (const r of listMeetingJoinRequests(meeting)) {
    if ((normalizeParticipantId(r.userId) ?? r.userId.trim()) === ns) return r;
  }
  return null;
}

function assertMeetingHasCapacityForOneMore(m: Meeting): void {
  const cap = m.capacity;
  if (cap > 0 && cap < MEETING_CAPACITY_UNLIMITED) {
    const n = countDistinctMeetingParticipants(m);
    if (n >= cap) throw new Error('모집 인원이 가득 찼어요.');
  }
}

function mergeJoinRequestsReplaceUser(
  prev: MeetingJoinRequest[],
  nsUid: string,
  nextRow: MeetingJoinRequest,
): MeetingJoinRequest[] {
  const filtered = prev.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
  return [...filtered, nextRow];
}

/** 내 투표 스냅샷(없으면 null — 구 데이터 등) */
export function getParticipantVoteSnapshot(meeting: Meeting, phoneUserId: string): ParticipantVoteSnapshot | null {
  const ns = normalizeParticipantId(phoneUserId.trim());
  const log = meeting.participantVoteLog ?? [];
  return log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === ns) ?? null;
}

function countDistinctMeetingParticipants(m: Meeting): number {
  const hostRaw = m.createdBy?.trim() ?? '';
  const host = hostRaw ? normalizeParticipantId(hostRaw) ?? hostRaw : '';
  const listRaw = m.participantIds ?? [];
  const seen = new Set<string>();
  if (host) seen.add(host);
  for (const x of listRaw) {
    const id = normalizeParticipantId(String(x)) ?? String(x).trim();
    if (id) seen.add(id);
  }
  return seen.size;
}

/** 상단 배지: 모집중 → 모집 완료(정원 도달) → 확정(주관자 확정) */
export type MeetingRecruitmentPhase = 'recruiting' | 'full' | 'confirmed';

export function getMeetingRecruitmentPhase(m: Meeting): MeetingRecruitmentPhase {
  if (m.scheduleConfirmed === true) return 'confirmed';
  const cap = m.capacity;
  if (cap > 0 && cap < MEETING_CAPACITY_UNLIMITED) {
    const n = countDistinctMeetingParticipants(m);
    if (n >= cap) return 'full';
  }
  return 'recruiting';
}

/** 동일 최다 득표를 받은 칩 id 목록(0표면 전원 동점으로 간주) */
export function resolveVoteTopTies(
  chipIds: readonly string[],
  tallyMap: Record<string, number> | undefined,
): { maxVotes: number; topIds: string[] } {
  const map = tallyMap ?? {};
  if (chipIds.length === 0) return { maxVotes: 0, topIds: [] };
  const maxVotes = Math.max(...chipIds.map((id) => map[id] ?? 0));
  const topIds = chipIds.filter((id) => (map[id] ?? 0) === maxVotes);
  return { maxVotes, topIds };
}

function extractMovieExtrasForVote(extra: Meeting['extraData']): SelectedMovieExtra[] {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return [];
  const e = extra as MeetingExtraData;
  if (Array.isArray(e.movies) && e.movies.length > 0) {
    return e.movies.filter((x): x is SelectedMovieExtra => x != null && String(x.title ?? '').trim() !== '');
  }
  if (e.movie != null && typeof e.movie === 'object' && String((e.movie as SelectedMovieExtra).title ?? '').trim() !== '') {
    return [e.movie as SelectedMovieExtra];
  }
  return [];
}

/** `app/meeting/[id].tsx` `buildDateChipsFromCandidates` 빈 목록 mock 과 동일 */
const EMPTY_DATE_VOTE_FALLBACK_CHIP_IDS = ['mock-1', 'mock-2'] as const;

/** 상세 화면 투표 칩 id와 동일한 규칙으로 후보별 id 목록을 만듭니다. */
export function buildMeetingVoteChipLists(m: Meeting): {
  dateChipIds: string[];
  placeChipIds: string[];
  movieChipIds: string[];
} {
  const dateList = m.dateCandidates ?? [];
  const dateChipIds =
    dateList.length > 0
      ? dateList.map((d, i) => {
          const id = typeof d.id === 'string' ? d.id.trim() : '';
          return id || `dc-${i}`;
        })
      : [...EMPTY_DATE_VOTE_FALLBACK_CHIP_IDS];

  const places = m.placeCandidates ?? [];
  let placeChipIds = places.map((p, i) => {
    const pid = typeof p.id === 'string' ? p.id.trim() : '';
    return pid || `pc-${i}`;
  });
  if (placeChipIds.length === 0) {
    const name = m.placeName?.trim() || m.location?.trim();
    const addr = m.address?.trim();
    if (name || addr) {
      placeChipIds = ['legacy-place'];
    }
  }
  const movies = extractMovieExtrasForVote(m.extraData);
  const movieChipIds =
    movies.length > 0
      ? movies.map((mv, i) => {
          const mid = String(mv.id ?? '').trim();
          return mid ? `${mid}#${i}` : `movie-${i}`;
        })
      : [];
  return { dateChipIds, placeChipIds, movieChipIds };
}

export type ConfirmVoteCategoryState =
  | { mode: 'none' }
  | { mode: 'ready'; chosenChipId: string }
  | { mode: 'tieNeedsPick'; topChipIds: string[] };

/** 주관자가 동점일 때 택한 칩 id (해당 구역만) */
export type ConfirmMeetingHostTiePicks = {
  dateChipId?: string | null;
  placeChipId?: string | null;
  movieChipId?: string | null;
};

function classifyVoteCategory(
  chipIds: readonly string[],
  tallyMap: Record<string, number> | undefined,
  hostPick: string | null | undefined,
): ConfirmVoteCategoryState {
  if (chipIds.length === 0) return { mode: 'none' };
  const { topIds } = resolveVoteTopTies(chipIds, tallyMap);
  if (topIds.length <= 1) {
    return { mode: 'ready', chosenChipId: topIds[0]! };
  }
  const p = (hostPick ?? '').trim();
  if (p && topIds.includes(p)) {
    return { mode: 'ready', chosenChipId: p };
  }
  return { mode: 'tieNeedsPick', topChipIds: topIds };
}

export function computeMeetingConfirmAnalysis(
  m: Meeting,
  hostTiePicks: ConfirmMeetingHostTiePicks,
): {
  date: ConfirmVoteCategoryState;
  place: ConfirmVoteCategoryState;
  movie: ConfirmVoteCategoryState;
  allReady: boolean;
  firstBlock: { section: 'date' | 'place' | 'movie'; message: string } | null;
  resolvedPicks: { dateChipId: string | null; placeChipId: string | null; movieChipId: string | null };
} {
  const lists = buildMeetingVoteChipLists(m);
  const vt = m.voteTallies ?? {};
  const date = classifyVoteCategory(lists.dateChipIds, vt.dates, hostTiePicks.dateChipId);
  const place = classifyVoteCategory(lists.placeChipIds, vt.places, hostTiePicks.placeChipId);
  const movie = classifyVoteCategory(lists.movieChipIds, vt.movies, hostTiePicks.movieChipId);

  const tieMessage =
    '표 수가 같은 후보가 있어요. 동점인 항목 중 하나를 탭으로 선택한 뒤 다시 확정해 주세요.';

  let firstBlock: { section: 'date' | 'place' | 'movie'; message: string } | null = null;
  if (date.mode === 'tieNeedsPick') firstBlock = { section: 'date', message: tieMessage };
  else if (movie.mode === 'tieNeedsPick') firstBlock = { section: 'movie', message: tieMessage };
  else if (place.mode === 'tieNeedsPick') firstBlock = { section: 'place', message: tieMessage };

  const allReady =
    date.mode !== 'tieNeedsPick' && place.mode !== 'tieNeedsPick' && movie.mode !== 'tieNeedsPick';

  const pick = (s: ConfirmVoteCategoryState): string | null =>
    s.mode === 'ready' ? s.chosenChipId : null;

  return {
    date,
    place,
    movie,
    allReady,
    firstBlock,
    resolvedPicks: {
      dateChipId: pick(date),
      placeChipId: pick(place),
      movieChipId: pick(movie),
    },
  };
}

export function mapFirestoreMeetingDoc(id: string, data: Record<string, unknown>): Meeting {
  const readAtRaw = (data.chatReadAtBy ?? null) as unknown;
  const chatReadAtBy =
    readAtRaw && typeof readAtRaw === 'object' && !Array.isArray(readAtRaw) ? (readAtRaw as Record<string, Timestamp | null>) : null;
  const readIdRaw = (data.chatReadMessageIdBy ?? null) as unknown;
  const chatReadMessageIdBy =
    readIdRaw && typeof readIdRaw === 'object' && !Array.isArray(readIdRaw) ? (readIdRaw as Record<string, string>) : null;
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    location: typeof data.location === 'string' ? data.location : '',
    description: typeof data.description === 'string' ? data.description : '',
    capacity: typeof data.capacity === 'number' && Number.isFinite(data.capacity) ? data.capacity : 0,
    minParticipants:
      typeof data.minParticipants === 'number' && Number.isFinite(data.minParticipants)
        ? data.minParticipants
        : null,
    createdAt: (data.createdAt as Meeting['createdAt']) ?? null,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : null,
    imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : null,
    categoryLabel: typeof data.categoryLabel === 'string' ? data.categoryLabel : null,
    isPublic: typeof data.isPublic === 'boolean' ? data.isPublic : null,
    scheduleDate: typeof data.scheduleDate === 'string' ? data.scheduleDate : null,
    scheduleTime: typeof data.scheduleTime === 'string' ? data.scheduleTime : null,
    scheduledAt: (data.scheduledAt as Meeting['scheduledAt']) ?? null,
    placeName: typeof data.placeName === 'string' ? data.placeName : null,
    address: typeof data.address === 'string' ? data.address : null,
    latitude: typeof data.latitude === 'number' && Number.isFinite(data.latitude) ? data.latitude : null,
    longitude: typeof data.longitude === 'number' && Number.isFinite(data.longitude) ? data.longitude : null,
    extraData: (data.extraData as Meeting['extraData']) ?? null,
    meetingConfig: (data.meetingConfig as Meeting['meetingConfig']) ?? null,
    dateCandidates: Array.isArray(data.dateCandidates) ? (data.dateCandidates as DateCandidate[]) : null,
    placeCandidates: Array.isArray(data.placeCandidates)
      ? (data.placeCandidates as Meeting['placeCandidates'])
      : null,
    participantIds: Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : null,
    voteTallies: parseVoteTalliesField(data),
    participantVoteLog: parseParticipantVoteLog(data),
    scheduleConfirmed: data.scheduleConfirmed === true,
    confirmedDateChipId:
      typeof data.confirmedDateChipId === 'string' && data.confirmedDateChipId.trim()
        ? data.confirmedDateChipId.trim()
        : null,
    confirmedPlaceChipId:
      typeof data.confirmedPlaceChipId === 'string' && data.confirmedPlaceChipId.trim()
        ? data.confirmedPlaceChipId.trim()
        : null,
    confirmedMovieChipId:
      typeof data.confirmedMovieChipId === 'string' && data.confirmedMovieChipId.trim()
        ? data.confirmedMovieChipId.trim()
        : null,
    chatReadAtBy,
    chatReadMessageIdBy,
    joinRequests: parseJoinRequestsField(data),
    kickedParticipantIds: (() => {
      const xs = parseKickedParticipantIdsField(data);
      return xs.length ? xs : null;
    })(),
  };
}

export async function getMeetingById(meetingId: string): Promise<Meeting | null> {
  const id = meetingId.trim();
  if (!id) return null;
  if (ledgerWritesToSupabase() && isLedgerMeetingId(id)) {
    try {
      const data = await ledgerTryLoadMeetingDoc(id);
      if (!data) return null;
      return mapFirestoreMeetingDoc(id, data);
    } catch {
      return null;
    }
  }
  const snap = await getDoc(doc(getFirestoreDb(), MEETINGS_COLLECTION, id));
  if (!snap.exists()) return null;
  return mapFirestoreMeetingDoc(snap.id, snap.data() as Record<string, unknown>);
}

/** 단일 모임 문서 실시간 구독(참여자 목록 갱신 등) */
export function subscribeMeetingById(
  meetingId: string,
  onMeeting: (meeting: Meeting | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const id = typeof meetingId === 'string' ? meetingId.trim() : String(meetingId ?? '').trim();
  if (!id) {
    onMeeting(null);
    return () => {};
  }
  if (ledgerWritesToSupabase() && isLedgerMeetingId(id)) {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let channelErrorRetries = 0;
    const maxChannelErrorRetries = 12;

    const emit = () => {
      if (cancelled) return;
      void ledgerGetMeetingDocOutcome(id).then((outcome) => {
        if (cancelled) return;
        if (outcome.status === 'failed') return;
        if (outcome.status === 'missing') onMeeting(null);
        else onMeeting(mapFirestoreMeetingDoc(id, outcome.doc));
      });
    };

    const dropChannel = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      dropChannel();
      const topic = `meetings-ledger:${id}:${Math.random().toString(36).slice(2)}`;
      channel = supabase
        .channel(topic)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter: `id=eq.${id}` }, () => {
          emit();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channelErrorRetries = 0;
            return;
          }
          if (status !== 'CHANNEL_ERROR') return;
          if (__DEV__) {
            console.warn('[subscribeMeetingById] ledger realtime CHANNEL_ERROR (reconnecting)', id);
          }
          emit();
          dropChannel();
          if (cancelled) return;
          channelErrorRetries += 1;
          if (channelErrorRetries > maxChannelErrorRetries) {
            if (__DEV__) {
              console.warn('[subscribeMeetingById] ledger realtime: max reconnect attempts', id);
            }
            return;
          }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 600);
        });
    };

    emit();
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      dropChannel();
    };
  }
  const dRef = doc(getFirestoreDb(), MEETINGS_COLLECTION, id);
  return onSnapshot(
    dRef,
    (snap) => {
      if (!snap.exists()) {
        onMeeting(null);
        return;
      }
      onMeeting(mapFirestoreMeetingDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    (err) => {
      onError?.(err.message ?? 'Firestore 구독 오류');
    },
  );
}

/** 일시 후보만 갱신 (상세 화면 날짜 제안 등) */
export async function updateMeetingDateCandidates(
  meetingId: string,
  dateCandidates: DateCandidate[],
  opts?: { priorDateCandidates?: readonly DateCandidate[] | null },
): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  const prior = opts?.priorDateCandidates ?? null;
  if (prior != null) {
    const priorIds = new Set(prior.map((c) => String(c.id ?? '').trim()).filter(Boolean));
    for (const c of dateCandidates) {
      const cid = String(c.id ?? '').trim();
      if (!cid || priorIds.has(cid)) continue;
      const addErr = validateNewDateProposalCandidate(c);
      if (addErr) throw new Error(addErr);
    }
  }
  const dateErr = validateDateCandidatesForSave(dateCandidates, new Date(), { oneMonthMax: false });
  if (dateErr) throw new Error(dateErr);
  if (ledgerWritesToSupabase() && isLedgerMeetingId(id)) {
    const data = await ledgerTryLoadMeetingDoc(id);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const next = {
      ...data,
      dateCandidates: dateCandidates.length ? stripUndefinedDeep(dateCandidates) : null,
    };
    await ledgerMeetingPutRawDoc(id, stripUndefinedDeep(next) as Record<string, unknown>);
    const after = await getMeetingById(id);
    if (after?.createdBy?.trim()) {
      notifyMeetingParticipantsOfHostActionFireAndForget(after, 'dates_updated', after.createdBy.trim());
    }
    return;
  }
  await updateDoc(doc(getFirestoreDb(), MEETINGS_COLLECTION, id), {
    dateCandidates: dateCandidates.length ? stripUndefinedDeep(dateCandidates) : null,
  });
  const after = await getMeetingById(id);
  if (after?.createdBy?.trim()) {
    notifyMeetingParticipantsOfHostActionFireAndForget(after, 'dates_updated', after.createdBy.trim());
  }
}

type PlaceCandidateDoc = NonNullable<Meeting['placeCandidates']>[number];

/** 장소 후보만 갱신 (상세 화면 장소 제안 등) */
export async function updateMeetingPlaceCandidates(
  meetingId: string,
  placeCandidates: PlaceCandidateDoc[],
): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  if (ledgerWritesToSupabase() && isLedgerMeetingId(id)) {
    const data = await ledgerTryLoadMeetingDoc(id);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const next = {
      ...data,
      placeCandidates: placeCandidates.length ? stripUndefinedDeep(placeCandidates) : null,
    };
    await ledgerMeetingPutRawDoc(id, stripUndefinedDeep(next) as Record<string, unknown>);
    const after = await getMeetingById(id);
    if (after?.createdBy?.trim()) {
      notifyMeetingParticipantsOfHostActionFireAndForget(after, 'places_updated', after.createdBy.trim());
    }
    return;
  }
  await updateDoc(doc(getFirestoreDb(), MEETINGS_COLLECTION, id), {
    placeCandidates: placeCandidates.length ? stripUndefinedDeep(placeCandidates) : null,
  });
  const after = await getMeetingById(id);
  if (after?.createdBy?.trim()) {
    notifyMeetingParticipantsOfHostActionFireAndForget(after, 'places_updated', after.createdBy.trim());
  }
}

export type MeetingBasicFieldsPatch = {
  title: string;
  description: string;
  isPublic: boolean;
  capacity: number;
  minParticipants: number;
  /** 공개 모임일 때 필수. 비공개로 저장할 때는 `null`로 비웁니다. */
  meetingConfig?: PublicMeetingDetailsConfig | null;
};

/**
 * 주관자가 모임 이름·소개·공개 여부·정원(최소/최대)을 수정합니다. (Firestore 또는 Ledger)
 */
export async function updateMeetingBasicFieldsByHost(
  meetingId: string,
  hostUserId: string,
  patch: MeetingBasicFieldsPatch,
): Promise<void> {
  const mid = meetingId.trim();
  const uid = hostUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 주관자 정보가 없습니다.');

  const title = patch.title.trim();
  if (!title) throw new Error('모임 이름을 입력해 주세요.');

  const capacity = toFiniteInt(patch.capacity, MEETING_PARTICIPANT_MIN);
  const minParticipants = toFiniteInt(patch.minParticipants, MEETING_PARTICIPANT_MIN);
  const isPublic = Boolean(patch.isPublic);

  if (isPublic) {
    if (minParticipants < MEETING_PARTICIPANT_MIN || minParticipants > 100) {
      throw new Error('최소 인원을 확인해 주세요.');
    }
    const maxUnlimited = capacity === MEETING_CAPACITY_UNLIMITED;
    if (
      !maxUnlimited &&
      (capacity < MEETING_PARTICIPANT_MIN || capacity > 100 || capacity < minParticipants)
    ) {
      throw new Error('최대 인원을 확인해 주세요.');
    }
  } else {
    if (
      minParticipants < MEETING_PARTICIPANT_MIN ||
      minParticipants > 100 ||
      minParticipants !== capacity
    ) {
      throw new Error('참석 인원을 확인해 주세요.');
    }
  }

  const description = patch.description.trim();

  let meetingConfigOut: PublicMeetingDetailsConfig | Record<string, unknown> | null = null;
  if (isPublic) {
    const cfg = patch.meetingConfig;
    if (cfg == null || typeof cfg !== 'object') {
      throw new Error('공개 모임은 상세 조건을 저장한 뒤 다시 시도해 주세요.');
    }
    if (
      cfg.settlement === 'MEMBERSHIP_FEE' &&
      (typeof cfg.membershipFeeWon !== 'number' ||
        !Number.isFinite(cfg.membershipFeeWon) ||
        cfg.membershipFeeWon < 1 ||
        cfg.membershipFeeWon > 100_000)
    ) {
      throw new Error('회비를 선택한 경우 1원 이상 10만 원 이하로 입력해 주세요.');
    }
    meetingConfigOut = stripUndefinedDeep(cfg) as Record<string, unknown>;
  }

  const assertHostAndCount = (data: Record<string, unknown>, nsHost: string) => {
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) {
      throw new Error('모임 주관자만 수정할 수 있어요.');
    }
    const m = mapFirestoreMeetingDoc(mid, data);
    const count = meetingParticipantCount(m);
    if (capacity !== MEETING_CAPACITY_UNLIMITED && capacity < count) {
      throw new Error(`현재 참여 ${count}명보다 작은 정원으로 줄일 수 없어요.`);
    }
    if (isPublic && capacity !== MEETING_CAPACITY_UNLIMITED && minParticipants > capacity) {
      throw new Error('최소 인원이 최대 인원보다 클 수 없어요.');
    }
  };

  const nsHost = normalizeParticipantId(uid) ?? uid;

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    assertHostAndCount(data, nsHost);
    const next = {
      ...data,
      title,
      description,
      isPublic,
      capacity,
      minParticipants,
      meetingConfig: meetingConfigOut,
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(next) as Record<string, unknown>);
    const after = await getMeetingById(mid);
    if (after?.createdBy?.trim()) {
      notifyMeetingParticipantsOfHostActionFireAndForget(after, 'details_updated', after.createdBy.trim());
    }
    return;
  }

  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const data = snap.data() as Record<string, unknown>;
  assertHostAndCount(data, nsHost);

  await updateDoc(ref, {
    title,
    description,
    isPublic,
    capacity,
    minParticipants,
    meetingConfig: meetingConfigOut,
  });
  const after = await getMeetingById(mid);
  if (after?.createdBy?.trim()) {
    notifyMeetingParticipantsOfHostActionFireAndForget(after, 'details_updated', after.createdBy.trim());
  }
}

/**
 * 참여자 추가 + 선택한 투표 항목마다 득표 +1 (한 트랜잭션).
 * 이미 동일 사용자가 참여 목록에 있으면 아무 것도 하지 않습니다.
 */
export async function joinMeeting(
  meetingId: string,
  phoneUserId: string,
  votes: { dateChipIds: readonly string[]; placeChipIds: readonly string[]; movieChipIds: readonly string[] },
): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const nsUid = normalizeParticipantId(uid) ?? uid;

  const profile = await getUserProfile(uid);
  if (!profile || !isMeetingServiceComplianceComplete(profile, uid)) {
    throw new Error('모임 이용 인증(약관 동의·필수 정보)을 완료한 사용자만 모임에 참여할 수 있어요. 설정에서 인증 정보 등록을 완료해 주세요.');
  }

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const joinBlock = getJoinGamificationBlockReason(profile, data);
    if (joinBlock) throw new Error(joinBlock);
    assertParticipantNotKickedFromMeetingDoc(data, nsUid);
    const mPre = mapFirestoreMeetingDoc(mid, data);
    const overlapBuf = getScheduleOverlapBufferHours(profile);
    if (mPre.scheduleConfirmed === true) {
      const startMs = meetingPrimaryStartMs(mPre);
      if (startMs != null) {
        await assertProposedStartsOverlapHybrid({
          appUserId: uid,
          startMsList: [startMs],
          bufferHours: overlapBuf,
          excludeMeetingId: mid,
        });
      }
    } else {
      const chipStarts: number[] = [];
      for (const chipId of votes.dateChipIds) {
        const ms = meetingStartMsForResolvedDateChip(mPre, chipId);
        if (ms != null) chipStarts.push(ms);
      }
      if (chipStarts.length > 0) {
        await assertProposedStartsOverlapHybrid({
          appUserId: uid,
          startMsList: chipStarts,
          bufferHours: overlapBuf,
          excludeMeetingId: mid,
        });
      }
    }
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (inList) return;
    if (meetingDocRequiresHostApprovalJoin(data)) {
      throw new Error('이 모임은 호스트 승인 방식이에요. 아래「참가 신청」으로 신청해 주세요.');
    }
    const prev = parseVoteTalliesField(data) ?? {};
    const dates = mergeTallyIncrement(prev.dates, votes.dateChipIds);
    const places = mergeTallyIncrement(prev.places, votes.placeChipIds);
    const movies = mergeTallyIncrement(prev.movies, votes.movieChipIds);
    const log = parseParticipantVoteLog(data);
    const filtered = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
    const nextLog: ParticipantVoteSnapshot[] = [
      ...filtered,
      {
        userId: nsUid,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];
    const nextDoc = {
      ...data,
      participantIds: [...rawList, nsUid],
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: stripUndefinedDeep(nextLog),
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextDoc) as Record<string, unknown>);
    const hostId = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    if (hostId) {
      notifyMeetingHostParticipantEventFireAndForget(
        mapFirestoreMeetingDoc(mid, nextDoc as Record<string, unknown>),
        hostId,
        uid,
        'joined',
        profile.nickname || profile.displayName || '참여자',
      );
    }
    return;
  }

  const preSnap = await getDoc(ref);
  if (!preSnap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const preSnapData = preSnap.data() as Record<string, unknown>;
  const joinBlock = getJoinGamificationBlockReason(profile, preSnapData);
  if (joinBlock) throw new Error(joinBlock);
  assertParticipantNotKickedFromMeetingDoc(preSnapData, nsUid);
  const mPreFs = mapFirestoreMeetingDoc(mid, preSnapData);
  const overlapBufFs = getScheduleOverlapBufferHours(profile);
  if (mPreFs.scheduleConfirmed === true) {
    const startMs = meetingPrimaryStartMs(mPreFs);
    if (startMs != null) {
      await assertProposedStartsOverlapHybrid({
        appUserId: uid,
        startMsList: [startMs],
        bufferHours: overlapBufFs,
        excludeMeetingId: mid,
      });
    }
  } else {
    const chipStartsFs: number[] = [];
    for (const chipId of votes.dateChipIds) {
      const ms = meetingStartMsForResolvedDateChip(mPreFs, chipId);
      if (ms != null) chipStartsFs.push(ms);
    }
    if (chipStartsFs.length > 0) {
      await assertProposedStartsOverlapHybrid({
        appUserId: uid,
        startMsList: chipStartsFs,
        bufferHours: overlapBufFs,
        excludeMeetingId: mid,
      });
    }
  }

  const preJoinData = preSnapData;
  const preJoinRaw = Array.isArray(preJoinData.participantIds)
    ? (preJoinData.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const preAlreadyIn = preJoinRaw.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
  if (preAlreadyIn) return;
  if (meetingDocRequiresHostApprovalJoin(preJoinData)) {
    throw new Error('이 모임은 호스트 승인 방식이에요. 아래「참가 신청」으로 신청해 주세요.');
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    assertParticipantNotKickedFromMeetingDoc(data, nsUid);
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (inList) {
      return;
    }
    if (meetingDocRequiresHostApprovalJoin(data)) {
      throw new Error('이 모임은 호스트 승인 방식이에요. 아래「참가 신청」으로 신청해 주세요.');
    }
    const prev = parseVoteTalliesField(data) ?? {};
    const dates = mergeTallyIncrement(prev.dates, votes.dateChipIds);
    const places = mergeTallyIncrement(prev.places, votes.placeChipIds);
    const movies = mergeTallyIncrement(prev.movies, votes.movieChipIds);

    const log = parseParticipantVoteLog(data);
    const filtered = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
    const nextLog: ParticipantVoteSnapshot[] = [
      ...filtered,
      {
        userId: nsUid,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];

    transaction.update(ref, {
      participantIds: arrayUnion(nsUid),
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: stripUndefinedDeep(nextLog),
    });
  });

  const after = await getMeetingById(mid);
  const hostId = after?.createdBy?.trim() ?? '';
  if (after && hostId) {
    notifyMeetingHostParticipantEventFireAndForget(
      after,
      hostId,
      uid,
      'joined',
      profile.nickname || profile.displayName || '참여자',
    );
  }
}

async function assertJoinOverlapPrechecks(
  profile: UserProfile,
  uid: string,
  mid: string,
  mPre: Meeting,
  votes: { dateChipIds: readonly string[]; placeChipIds: readonly string[]; movieChipIds: readonly string[] },
): Promise<void> {
  const overlapBuf = getScheduleOverlapBufferHours(profile);
  if (mPre.scheduleConfirmed === true) {
    const startMs = meetingPrimaryStartMs(mPre);
    if (startMs != null) {
      await assertProposedStartsOverlapHybrid({
        appUserId: uid,
        startMsList: [startMs],
        bufferHours: overlapBuf,
        excludeMeetingId: mid,
      });
    }
  } else {
    const chipStarts: number[] = [];
    for (const chipId of votes.dateChipIds) {
      const ms = meetingStartMsForResolvedDateChip(mPre, chipId);
      if (ms != null) chipStarts.push(ms);
    }
    if (chipStarts.length > 0) {
      await assertProposedStartsOverlapHybrid({
        appUserId: uid,
        startMsList: chipStarts,
        bufferHours: overlapBuf,
        excludeMeetingId: mid,
      });
    }
  }
}

/**
 * 공개 모임 + 호스트 승인: 참여자 목록에 올리지 않고 `joinRequests`에만 적재합니다.
 * 호스트는 `approveJoinRequest` / `rejectJoinRequest`, 신청자는 `cancelJoinRequest`로 정리합니다.
 */
export async function requestJoinMeeting(
  meetingId: string,
  phoneUserId: string,
  votes: { dateChipIds: readonly string[]; placeChipIds: readonly string[]; movieChipIds: readonly string[] },
  opts?: { message?: string | null },
): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsUid = normalizeParticipantId(uid) ?? uid;
  const profile = await getUserProfile(uid);
  if (!profile || !isMeetingServiceComplianceComplete(profile, uid)) {
    throw new Error('모임 이용 인증(약관 동의·필수 정보)을 완료한 사용자만 신청할 수 있어요. 설정에서 인증 정보 등록을 완료해 주세요.');
  }
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const fresh = await ledgerTryLoadMeetingDoc(mid);
    if (!fresh) throw new Error('모임을 찾을 수 없어요.');
    if (!meetingDocRequiresHostApprovalJoin(fresh)) {
      throw new Error('호스트 승인 방식의 공개 모임만 참가 신청을 보낼 수 있어요.');
    }
    const joinBlockFresh = getJoinGamificationBlockReason(profile, fresh);
    if (joinBlockFresh) throw new Error(joinBlockFresh);
    assertParticipantNotKickedFromMeetingDoc(fresh, nsUid);
    const mPreFresh = mapFirestoreMeetingDoc(mid, fresh);
    assertMeetingHasCapacityForOneMore(mPreFresh);
    await assertJoinOverlapPrechecks(profile, uid, mid, mPreFresh, votes);
    const preWrite = await ledgerTryLoadMeetingDoc(mid);
    if (!preWrite) throw new Error('모임을 찾을 수 없어요.');
    assertParticipantNotKickedFromMeetingDoc(preWrite, nsUid);
    const mPreWrite = mapFirestoreMeetingDoc(mid, preWrite);
    assertMeetingHasCapacityForOneMore(mPreWrite);
    const rawListWrite = Array.isArray(preWrite.participantIds)
      ? (preWrite.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (rawListWrite.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid)) return;
    const hostPkWrite =
      typeof preWrite.createdBy === 'string' ? normalizeParticipantId(preWrite.createdBy.trim()) ?? preWrite.createdBy.trim() : '';
    if (hostPkWrite && hostPkWrite === nsUid) throw new Error('호스트는 참가 신청을 보낼 수 없어요.');
    const cfgWrite = parsePublicMeetingDetailsConfig(preWrite.meetingConfig);
    let messageOutWrite: string | null | undefined;
    if (cfgWrite?.requestMessageEnabled === true) {
      const raw = typeof opts?.message === 'string' ? opts.message.trim() : '';
      messageOutWrite = raw ? raw.slice(0, MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN) : null;
    }
    const prevJr = parseJoinRequestsField(preWrite);
    const row: MeetingJoinRequest = {
      userId: nsUid,
      dateChipIds: [...votes.dateChipIds],
      placeChipIds: [...votes.placeChipIds],
      movieChipIds: [...votes.movieChipIds],
      requestedAt: new Date().toISOString(),
      ...(messageOutWrite !== undefined ? { message: messageOutWrite } : {}),
    };
    const nextJr = mergeJoinRequestsReplaceUser(prevJr, nsUid, row);
    const nextDoc = {
      ...preWrite,
      joinRequests: stripUndefinedDeep(nextJr) as unknown as MeetingJoinRequest[],
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextDoc) as Record<string, unknown>);
    const hostId = typeof preWrite.createdBy === 'string' ? preWrite.createdBy.trim() : '';
    if (hostId) {
      notifyMeetingHostParticipantEventFireAndForget(
        mapFirestoreMeetingDoc(mid, nextDoc as Record<string, unknown>),
        hostId,
        uid,
        'join_requested',
        profile.nickname || profile.displayName || '참여자',
      );
    }
    return;
  }

  const preSnap = await getDoc(ref);
  if (!preSnap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const preData = preSnap.data() as Record<string, unknown>;
  if (!meetingDocRequiresHostApprovalJoin(preData)) {
    throw new Error('호스트 승인 방식의 공개 모임만 참가 신청을 보낼 수 있어요.');
  }
  const joinBlock = getJoinGamificationBlockReason(profile, preData);
  if (joinBlock) throw new Error(joinBlock);
  assertParticipantNotKickedFromMeetingDoc(preData, nsUid);
  const mPreFs = mapFirestoreMeetingDoc(mid, preData);
  assertMeetingHasCapacityForOneMore(mPreFs);
  await assertJoinOverlapPrechecks(profile, uid, mid, mPreFs, votes);
  const preRaw = Array.isArray(preData.participantIds)
    ? (preData.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  if (preRaw.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid)) return;
  const hostPre = typeof preData.createdBy === 'string' ? normalizeParticipantId(preData.createdBy.trim()) ?? preData.createdBy.trim() : '';
  if (hostPre && hostPre === nsUid) throw new Error('호스트는 참가 신청을 보낼 수 없어요.');

  const cfgFs = parsePublicMeetingDetailsConfig(preData.meetingConfig);
  let messageFs: string | null | undefined;
  if (cfgFs?.requestMessageEnabled === true) {
    const raw = typeof opts?.message === 'string' ? opts.message.trim() : '';
    messageFs = raw ? raw.slice(0, MEETING_JOIN_REQUEST_MESSAGE_MAX_LEN) : null;
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    if (!meetingDocRequiresHostApprovalJoin(data)) {
      throw new Error('호스트 승인 방식의 공개 모임만 참가 신청을 보낼 수 있어요.');
    }
    assertParticipantNotKickedFromMeetingDoc(data, nsUid);
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid)) return;
    const prevJr = parseJoinRequestsField(data);
    const row: MeetingJoinRequest = {
      userId: nsUid,
      dateChipIds: [...votes.dateChipIds],
      placeChipIds: [...votes.placeChipIds],
      movieChipIds: [...votes.movieChipIds],
      requestedAt: new Date().toISOString(),
      ...(messageFs !== undefined ? { message: messageFs } : {}),
    };
    const nextJr = mergeJoinRequestsReplaceUser(prevJr, nsUid, row);
    transaction.update(ref, {
      joinRequests: stripUndefinedDeep(nextJr),
    });
  });

  const after = await getMeetingById(mid);
  const hostId = after?.createdBy?.trim() ?? '';
  if (after && hostId) {
    notifyMeetingHostParticipantEventFireAndForget(
      after,
      hostId,
      uid,
      'join_requested',
      profile.nickname || profile.displayName || '참여자',
    );
  }
}

export async function cancelJoinRequest(meetingId: string, phoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsUid = normalizeParticipantId(uid) ?? uid;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const prevJr = parseJoinRequestsField(data);
    const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
    if (nextJr.length === prevJr.length) return;
    await ledgerMeetingPutRawDoc(
      mid,
      stripUndefinedDeep({
        ...data,
        joinRequests: nextJr.length ? nextJr : null,
      }) as Record<string, unknown>,
    );
    return;
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const prevJr = parseJoinRequestsField(data);
    const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
    if (nextJr.length === prevJr.length) return;
    transaction.update(ref, { joinRequests: nextJr.length ? stripUndefinedDeep(nextJr) : null });
  });
}

export async function rejectJoinRequest(meetingId: string, hostPhoneUserId: string, applicantUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const hostUid = hostPhoneUserId.trim();
  const appRaw = applicantUserId.trim();
  if (!mid || !hostUid || !appRaw) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsHost = normalizeParticipantId(hostUid) ?? hostUid;
  const nsApp = normalizeParticipantId(appRaw) ?? appRaw;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) throw new Error('모임 주관자만 거절할 수 있어요.');
    const prevJr = parseJoinRequestsField(data);
    const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
    if (nextJr.length === prevJr.length) return;
    await ledgerMeetingPutRawDoc(
      mid,
      stripUndefinedDeep({
        ...data,
        joinRequests: nextJr.length ? nextJr : null,
      }) as Record<string, unknown>,
    );
    const afterReject = await getMeetingById(mid);
    if (afterReject) {
      notifyMeetingJoinRequestApplicantDecisionFireAndForget(afterReject, appRaw, 'rejected');
    }
    return;
  }

  let fsRejectDidMutate = false;
  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) throw new Error('모임 주관자만 거절할 수 있어요.');
    const prevJr = parseJoinRequestsField(data);
    const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
    if (nextJr.length === prevJr.length) return;
    fsRejectDidMutate = true;
    transaction.update(ref, { joinRequests: nextJr.length ? stripUndefinedDeep(nextJr) : null });
  });
  if (fsRejectDidMutate) {
    const afterRejectFs = await getMeetingById(mid);
    if (afterRejectFs) {
      notifyMeetingJoinRequestApplicantDecisionFireAndForget(afterRejectFs, appRaw, 'rejected');
    }
  }
}

export async function approveJoinRequest(
  meetingId: string,
  hostPhoneUserId: string,
  applicantUserId: string,
): Promise<void> {
  const mid = meetingId.trim();
  const hostUid = hostPhoneUserId.trim();
  const appRaw = applicantUserId.trim();
  if (!mid || !hostUid || !appRaw) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsHost = normalizeParticipantId(hostUid) ?? hostUid;
  const nsApp = normalizeParticipantId(appRaw) ?? appRaw;
  if (!nsApp) throw new Error('신청자 정보가 올바르지 않아요.');
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  const applicantProfile = await getUserProfile(appRaw);
  if (!applicantProfile || !isMeetingServiceComplianceComplete(applicantProfile, appRaw)) {
    throw new Error('신청자가 모임 이용 인증을 완료하지 않아 승인할 수 없어요.');
  }

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) throw new Error('모임 주관자만 승인할 수 있어요.');
    const joinBlock = getJoinGamificationBlockReason(applicantProfile, data);
    if (joinBlock) throw new Error(`참가 자격 문제로 승인할 수 없어요: ${joinBlock}`);
    const prevJr = parseJoinRequestsField(data);
    const req = prevJr.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsApp);
    if (!req) throw new Error('대기 중인 참가 신청을 찾을 수 없어요.');
    assertParticipantNotKickedFromMeetingDoc(data, nsApp);
    const votes = {
      dateChipIds: req.dateChipIds,
      placeChipIds: req.placeChipIds,
      movieChipIds: req.movieChipIds,
    };
    const mPre = mapFirestoreMeetingDoc(mid, data);
    assertMeetingHasCapacityForOneMore(mPre);
    await assertJoinOverlapPrechecks(applicantProfile, appRaw, mid, mPre, votes);
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsApp)) {
      const nextJrOnly = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
      await ledgerMeetingPutRawDoc(
        mid,
        stripUndefinedDeep({
          ...data,
          joinRequests: nextJrOnly.length ? nextJrOnly : null,
        }) as Record<string, unknown>,
      );
      return;
    }
    const prev = parseVoteTalliesField(data) ?? {};
    const dates = mergeTallyIncrement(prev.dates, votes.dateChipIds);
    const places = mergeTallyIncrement(prev.places, votes.placeChipIds);
    const movies = mergeTallyIncrement(prev.movies, votes.movieChipIds);
    const log = parseParticipantVoteLog(data);
    const filtered = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
    const nextLog: ParticipantVoteSnapshot[] = [
      ...filtered,
      {
        userId: nsApp,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];
    const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
    const nextDoc = {
      ...data,
      participantIds: [...rawList, nsApp],
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: stripUndefinedDeep(nextLog),
      joinRequests: nextJr.length ? nextJr : null,
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextDoc) as Record<string, unknown>);
    const hostId = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const mJoined = mapFirestoreMeetingDoc(mid, nextDoc as Record<string, unknown>);
    if (hostId) {
      notifyMeetingHostParticipantEventFireAndForget(
        mJoined,
        hostId,
        appRaw,
        'joined',
        applicantProfile.nickname || applicantProfile.displayName || '참여자',
      );
    }
    notifyMeetingJoinRequestApplicantDecisionFireAndForget(mJoined, appRaw, 'approved');
    return;
  }

  const approveSnap = await getDoc(ref);
  if (!approveSnap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const approvePre = approveSnap.data() as Record<string, unknown>;
  const approveCreatedBy = typeof approvePre.createdBy === 'string' ? approvePre.createdBy.trim() : '';
  const approveNsCreated = approveCreatedBy ? normalizeParticipantId(approveCreatedBy) ?? approveCreatedBy : '';
  if (!approveNsCreated || approveNsCreated !== nsHost) throw new Error('모임 주관자만 승인할 수 있어요.');
  const joinBlockPre = getJoinGamificationBlockReason(applicantProfile, approvePre);
  if (joinBlockPre) throw new Error(`참가 자격 문제로 승인할 수 없어요: ${joinBlockPre}`);
  const prevJrPre = parseJoinRequestsField(approvePre);
  const reqPre = prevJrPre.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsApp);
  if (!reqPre) throw new Error('대기 중인 참가 신청을 찾을 수 없어요.');
  const approveVotes = {
    dateChipIds: reqPre.dateChipIds,
    placeChipIds: reqPre.placeChipIds,
    movieChipIds: reqPre.movieChipIds,
  };
  const mApprovePre = mapFirestoreMeetingDoc(mid, approvePre);
  assertMeetingHasCapacityForOneMore(mApprovePre);
  await assertJoinOverlapPrechecks(applicantProfile, appRaw, mid, mApprovePre, approveVotes);

  let fsApproveDidAddParticipant = false;
  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) throw new Error('모임 주관자만 승인할 수 있어요.');
    const joinBlock = getJoinGamificationBlockReason(applicantProfile, data);
    if (joinBlock) throw new Error(`참가 자격 문제로 승인할 수 없어요: ${joinBlock}`);
    const prevJr = parseJoinRequestsField(data);
    const req = prevJr.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsApp);
    if (!req) throw new Error('대기 중인 참가 신청을 찾을 수 없어요.');
    assertParticipantNotKickedFromMeetingDoc(data, nsApp);
    const votes = {
      dateChipIds: req.dateChipIds,
      placeChipIds: req.placeChipIds,
      movieChipIds: req.movieChipIds,
    };
    const mTx = mapFirestoreMeetingDoc(mid, data);
    assertMeetingHasCapacityForOneMore(mTx);
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsApp)) {
      const nextJrOnly = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
      transaction.update(ref, {
        joinRequests: nextJrOnly.length ? stripUndefinedDeep(nextJrOnly) : null,
      });
      return;
    }
    fsApproveDidAddParticipant = true;
    const prev = parseVoteTalliesField(data) ?? {};
    const dates = mergeTallyIncrement(prev.dates, votes.dateChipIds);
    const places = mergeTallyIncrement(prev.places, votes.placeChipIds);
    const movies = mergeTallyIncrement(prev.movies, votes.movieChipIds);
    const log = parseParticipantVoteLog(data);
    const filtered = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
    const nextLog: ParticipantVoteSnapshot[] = [
      ...filtered,
      {
        userId: nsApp,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];
    const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsApp);
    transaction.update(ref, {
      participantIds: arrayUnion(nsApp),
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: stripUndefinedDeep(nextLog),
      joinRequests: nextJr.length ? stripUndefinedDeep(nextJr) : null,
    });
  });

  if (fsApproveDidAddParticipant) {
    const after = await getMeetingById(mid);
    const hostId = after?.createdBy?.trim() ?? '';
    if (after && hostId) {
      notifyMeetingHostParticipantEventFireAndForget(
        after,
        hostId,
        appRaw,
        'joined',
        applicantProfile.nickname || applicantProfile.displayName || '참여자',
      );
    }
    if (after) {
      notifyMeetingJoinRequestApplicantDecisionFireAndForget(after, appRaw, 'approved');
    }
  }
}

/** 참여자가 투표를 바꿀 때 집계·이력 갱신 */
export async function updateParticipantVotes(
  meetingId: string,
  phoneUserId: string,
  votes: { dateChipIds: readonly string[]; placeChipIds: readonly string[]; movieChipIds: readonly string[] },
): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const profile = await getUserProfile(uid);
  if (!profile || !isMeetingServiceComplianceComplete(profile, uid)) {
    throw new Error('모임 이용 인증(약관 동의·필수 정보)을 완료한 사용자만 모임에서 투표할 수 있어요. 설정에서 인증 정보 등록을 완료해 주세요.');
  }
  const nsUid = normalizeParticipantId(uid) ?? uid;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (!inList) throw new Error('참여 중인 모임만 투표를 수정할 수 있어요.');
    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid);
    if (!old) {
      throw new Error(
        '이 모임은 예전 방식으로만 참여되어 있어요. 투표를 바꾸려면 아래 탈퇴 후 다시 참여해 주세요.',
      );
    }
    const oldD = old.dateChipIds;
    const oldP = old.placeChipIds;
    const oldM = old.movieChipIds;
    const vt = parseVoteTalliesField(data) ?? {};
    let dates = mergeTallyDecrement({ ...vt.dates }, oldD);
    let places = mergeTallyDecrement({ ...vt.places }, oldP);
    let movies = mergeTallyDecrement({ ...vt.movies }, oldM);
    dates = mergeTallyIncrement(dates, votes.dateChipIds);
    places = mergeTallyIncrement(places, votes.placeChipIds);
    movies = mergeTallyIncrement(movies, votes.movieChipIds);
    const nextLog: ParticipantVoteSnapshot[] = [
      ...log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid),
      {
        userId: nsUid,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];
    await ledgerMeetingPutRawDoc(
      mid,
      stripUndefinedDeep({
        ...data,
        voteTallies: { dates, places, movies } as MeetingVoteTallies,
        participantVoteLog: nextLog,
      }) as Record<string, unknown>,
    );
    return;
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (!inList) throw new Error('참여 중인 모임만 투표를 수정할 수 있어요.');

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid);
    if (!old) {
      throw new Error(
        '이 모임은 예전 방식으로만 참여되어 있어요. 투표를 바꾸려면 아래 탈퇴 후 다시 참여해 주세요.',
      );
    }
    const oldD = old.dateChipIds;
    const oldP = old.placeChipIds;
    const oldM = old.movieChipIds;

    const vt = parseVoteTalliesField(data) ?? {};
    let dates = mergeTallyDecrement({ ...vt.dates }, oldD);
    let places = mergeTallyDecrement({ ...vt.places }, oldP);
    let movies = mergeTallyDecrement({ ...vt.movies }, oldM);
    dates = mergeTallyIncrement(dates, votes.dateChipIds);
    places = mergeTallyIncrement(places, votes.placeChipIds);
    movies = mergeTallyIncrement(movies, votes.movieChipIds);

    const nextLog: ParticipantVoteSnapshot[] = [
      ...log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid),
      {
        userId: nsUid,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];

    transaction.update(ref, {
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: stripUndefinedDeep(nextLog),
    });
  });
}

/**
 * 참여 중인 사용자의 투표를 저장합니다.
 * - 기존 `participantVoteLog`가 없으면(신규 생성자/마이그레이션 전 모임 등) 첫 저장으로 로그를 생성합니다.
 * - 기존 로그가 있으면 `updateParticipantVotes`와 동일하게 집계를 롤백 후 재반영합니다.
 */
export async function upsertParticipantVotes(
  meetingId: string,
  phoneUserId: string,
  votes: { dateChipIds: readonly string[]; placeChipIds: readonly string[]; movieChipIds: readonly string[] },
): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsUid = normalizeParticipantId(uid) ?? uid;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (!inList) throw new Error('참여 중인 모임만 투표를 수정할 수 있어요.');
    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];
    const vt = parseVoteTalliesField(data) ?? {};
    let dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    let places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    let movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    dates = mergeTallyIncrement(dates, votes.dateChipIds);
    places = mergeTallyIncrement(places, votes.placeChipIds);
    movies = mergeTallyIncrement(movies, votes.movieChipIds);
    const nextLog: ParticipantVoteSnapshot[] = [
      ...log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid),
      {
        userId: nsUid,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];
    await ledgerMeetingPutRawDoc(
      mid,
      stripUndefinedDeep({
        ...data,
        voteTallies: { dates, places, movies } as MeetingVoteTallies,
        participantVoteLog: nextLog,
      }) as Record<string, unknown>,
    );
    return;
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (!inList) throw new Error('참여 중인 모임만 투표를 수정할 수 있어요.');

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];

    const vt = parseVoteTalliesField(data) ?? {};
    let dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    let places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    let movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    dates = mergeTallyIncrement(dates, votes.dateChipIds);
    places = mergeTallyIncrement(places, votes.placeChipIds);
    movies = mergeTallyIncrement(movies, votes.movieChipIds);

    const nextLog: ParticipantVoteSnapshot[] = [
      ...log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid),
      {
        userId: nsUid,
        dateChipIds: [...votes.dateChipIds],
        placeChipIds: [...votes.placeChipIds],
        movieChipIds: [...votes.movieChipIds],
      },
    ];

    transaction.update(ref, {
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: stripUndefinedDeep(nextLog),
    });
  });
}

/** 참여 취소: 참여자 제거 + 해당 사용자 투표 집계 롤백 */
/** Supabase `meetings` 행이 있는 레저 모임 확정 시 주최자 XP — 실패해도 확정은 유지합니다. */
async function grantMeetingConfirmXpIfLedger(hostAppUserId: string, meetingId: string): Promise<void> {
  if (!ledgerWritesToSupabase() || !isLedgerMeetingId(meetingId)) return;
  try {
    const { error } = await supabase.rpc('apply_meeting_confirm_xp', {
      p_app_user_id: hostAppUserId.trim(),
      p_meeting_id: meetingId.trim(),
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[meetings] apply_meeting_confirm_xp:', error.message);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[meetings] apply_meeting_confirm_xp', e);
  }
}

const LEAVE_CONFIRMED_TRUST_RPC_WAITS_MS = [0, 800, 2500, 6000] as const;

function isRetryableLeaveConfirmedTrustRpcError(message: string, code?: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('schema cache') || m.includes('pgrst202')) return true;
  return code === 'PGRST202';
}

/**
 * 확정 일정 모임에서 나간 뒤 Supabase 프로필에 신뢰 패널티 반영(모임당 1회, idempotent).
 */
export async function applyTrustPenaltyLeaveConfirmedMeeting(
  phoneUserId: string,
  meetingFirestoreId: string,
): Promise<void> {
  const uid = phoneUserId.trim();
  const mid = meetingFirestoreId.trim();
  if (!uid || !mid) throw new Error('사용자 또는 모임 정보가 없습니다.');
  let lastMessage = '';
  for (let i = 0; i < LEAVE_CONFIRMED_TRUST_RPC_WAITS_MS.length; i += 1) {
    const wait = LEAVE_CONFIRMED_TRUST_RPC_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { error } = await supabase.rpc('apply_trust_penalty_leave_confirmed_meeting', {
      p_app_user_id: uid,
      p_meeting_firestore_id: mid,
    });
    if (!error) return;
    lastMessage = error.message?.trim() || 'apply_trust_penalty_leave_confirmed_meeting failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    const retryable = isRetryableLeaveConfirmedTrustRpcError(lastMessage, code);
    if (!retryable || i === LEAVE_CONFIRMED_TRUST_RPC_WAITS_MS.length - 1) {
      throw new Error(lastMessage);
    }
  }
}

export async function leaveMeeting(meetingId: string, phoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsUid = normalizeParticipantId(uid) ?? uid;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let removeToken: string | null = null;
    for (const x of rawList) {
      if ((normalizeParticipantId(x) ?? x.trim()) === nsUid) {
        removeToken = x;
        break;
      }
    }
    if (!removeToken) {
      const prevJr = parseJoinRequestsField(data);
      const nextJr = prevJr.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
      if (nextJr.length < prevJr.length) {
        await ledgerMeetingPutRawDoc(
          mid,
          stripUndefinedDeep({
            ...data,
            joinRequests: nextJr.length ? nextJr : null,
          }) as Record<string, unknown>,
        );
        return;
      }
      throw new Error('참여 중인 모임만 나갈 수 있어요.');
    }
    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];
    const vt = parseVoteTalliesField(data) ?? {};
    const dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    const places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    const movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    const nextLog = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);
    const patch: Record<string, unknown> = {
      ...data,
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: nextLog.length ? stripUndefinedDeep(nextLog) : null,
    };
    patch.participantIds = rawList.filter((x) => x !== removeToken);
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(patch) as Record<string, unknown>);
    const hostId = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    if (hostId && (normalizeParticipantId(hostId) ?? hostId) !== nsUid) {
      let nick = '참여자';
      try {
        const p = await getUserProfile(uid);
        nick = p?.nickname || p?.displayName || nick;
      } catch {
        /* ignore */
      }
      notifyMeetingHostParticipantEventFireAndForget(
        mapFirestoreMeetingDoc(mid, patch as Record<string, unknown>),
        hostId,
        uid,
        'left',
        nick,
      );
    }
    return;
  }

  const preLeaveFs = await getDoc(ref);
  if (!preLeaveFs.exists()) throw new Error('모임을 찾을 수 없어요.');
  const d0 = preLeaveFs.data() as Record<string, unknown>;
  const raw0 = Array.isArray(d0.participantIds)
    ? (d0.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const inParticipantFs = raw0.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
  if (!inParticipantFs) {
    const jr0 = parseJoinRequestsField(d0);
    if (jr0.some((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid)) {
      await cancelJoinRequest(mid, uid);
      return;
    }
    throw new Error('참여 중인 모임만 나갈 수 있어요.');
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let removeToken: string | null = null;
    for (const x of rawList) {
      if ((normalizeParticipantId(x) ?? x.trim()) === nsUid) {
        removeToken = x;
        break;
      }
    }
    if (!removeToken) throw new Error('참여 중인 모임만 나갈 수 있어요.');

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsUid);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];

    const vt = parseVoteTalliesField(data) ?? {};
    const dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    const places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    const movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    const nextLog = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsUid);

    const patch: Record<string, unknown> = {
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: nextLog.length ? stripUndefinedDeep(nextLog) : null,
    };
    patch.participantIds = arrayRemove(removeToken);
    transaction.update(ref, patch);
  });

  const after = await getMeetingById(mid);
  const hostId = after?.createdBy?.trim() ?? '';
  if (after && hostId && (normalizeParticipantId(hostId) ?? hostId) !== nsUid) {
    let nick = '참여자';
    try {
      const p = await getUserProfile(uid);
      nick = p?.nickname || p?.displayName || nick;
    } catch {
      /* ignore */
    }
    notifyMeetingHostParticipantEventFireAndForget(after, hostId, uid, 'left', nick);
  }
}

/**
 * 호스트가 참여자를 강제 퇴장시킵니다. 일정 확정 전에만 가능합니다.
 * 대상은 `kickedParticipantIds`에 기록되어 동일 모임 재참여·재신청이 차단됩니다.
 */
export async function hostRemoveParticipant(
  meetingId: string,
  hostPhoneUserId: string,
  targetUserId: string,
): Promise<void> {
  const mid = meetingId.trim();
  const hostUid = hostPhoneUserId.trim();
  const targetRaw = targetUserId.trim();
  if (!mid || !hostUid || !targetRaw) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsHost = normalizeParticipantId(hostUid) ?? hostUid;
  const nsTarget = normalizeParticipantId(targetRaw) ?? targetRaw;
  if (!nsTarget) throw new Error('대상 사용자 정보가 올바르지 않아요.');
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    if (data.scheduleConfirmed === true) {
      throw new Error('일정이 확정된 모임에서는 참여자를 강제 퇴장할 수 없어요.');
    }
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) throw new Error('모임 주관자만 참여자를 퇴장시킬 수 있어요.');
    if (nsTarget === nsCreated) throw new Error('호스트 본인은 이 방법으로 퇴장시킬 수 없어요.');
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let removeToken: string | null = null;
    for (const x of rawList) {
      if ((normalizeParticipantId(x) ?? x.trim()) === nsTarget) {
        removeToken = x;
        break;
      }
    }
    if (!removeToken) throw new Error('참여 중인 참여자만 강제 퇴장할 수 있어요.');

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsTarget);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];
    const vt = parseVoteTalliesField(data) ?? {};
    const dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    const places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    const movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    const nextLog = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsTarget);
    const nextKicked = mergeKickedParticipantIdsField(data, nsTarget);
    const prevJrKick = parseJoinRequestsField(data);
    const nextJrKick = prevJrKick.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsTarget);
    const patch: Record<string, unknown> = {
      ...data,
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: nextLog.length ? stripUndefinedDeep(nextLog) : null,
      kickedParticipantIds: nextKicked,
      joinRequests: nextJrKick.length ? stripUndefinedDeep(nextJrKick) : null,
    };
    patch.participantIds = rawList.filter((x) => x !== removeToken);
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(patch) as Record<string, unknown>);
    const mAfter = mapFirestoreMeetingDoc(mid, patch as Record<string, unknown>);
    notifyMeetingParticipantRemovedByHostFireAndForget(mAfter, targetRaw);
    return;
  }

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    if (data.scheduleConfirmed === true) {
      throw new Error('일정이 확정된 모임에서는 참여자를 강제 퇴장할 수 없어요.');
    }
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) throw new Error('모임 주관자만 참여자를 퇴장시킬 수 있어요.');
    if (nsTarget === nsCreated) throw new Error('호스트 본인은 이 방법으로 퇴장시킬 수 없어요.');
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let removeToken: string | null = null;
    for (const x of rawList) {
      if ((normalizeParticipantId(x) ?? x.trim()) === nsTarget) {
        removeToken = x;
        break;
      }
    }
    if (!removeToken) throw new Error('참여 중인 참여자만 강제 퇴장할 수 있어요.');

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) === nsTarget);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];
    const vt = parseVoteTalliesField(data) ?? {};
    const dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    const places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    const movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    const nextLog = log.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsTarget);
    const nextKicked = mergeKickedParticipantIdsField(data, nsTarget);
    const prevJrKick = parseJoinRequestsField(data);
    const nextJrKick = prevJrKick.filter((e) => (normalizeParticipantId(e.userId) ?? e.userId.trim()) !== nsTarget);
    transaction.update(ref, {
      voteTallies: stripUndefinedDeep({ dates, places, movies }) as MeetingVoteTallies,
      participantVoteLog: nextLog.length ? stripUndefinedDeep(nextLog) : null,
      participantIds: arrayRemove(removeToken),
      kickedParticipantIds: nextKicked,
      joinRequests: nextJrKick.length ? stripUndefinedDeep(nextJrKick) : null,
    });
  });

  const after = await getMeetingById(mid);
  if (after) notifyMeetingParticipantRemovedByHostFireAndForget(after, targetRaw);
}

/** 모임 주관자가 집계 투표(+동점 시 주관자 선택)로 일정·모집 확정 */
export async function confirmMeetingSchedule(
  meetingId: string,
  hostPhoneUserId: string,
  hostTiePicks: ConfirmMeetingHostTiePicks,
): Promise<void> {
  const mid = meetingId.trim();
  const uid = hostPhoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 주관자 정보가 없습니다.');
  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsHost = normalizeParticipantId(uid) ?? uid;
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) {
      throw new Error('모임 주관자만 일정을 확정할 수 있어요.');
    }
    const m = mapFirestoreMeetingDoc(mid, data);
    const analysis = computeMeetingConfirmAnalysis(m, hostTiePicks);
    if (!analysis.allReady) {
      throw new Error(analysis.firstBlock?.message ?? '투표 확정 조건을 만족하지 못했습니다.');
    }
    const rp = analysis.resolvedPicks;
    const sch = scheduleFieldsAfterHostConfirm(m, rp.dateChipId);
    if (sch) {
      const hostProf = await getUserProfile(uid);
      const buf = getScheduleOverlapBufferHours(hostProf);
      await assertNoConfirmedScheduleOverlapHybrid({
        appUserId: uid,
        startMs: sch.scheduledAt.toMillis(),
        bufferHours: buf,
        excludeMeetingId: mid,
      });
    }
    const nextLedgerDoc: Record<string, unknown> = {
      ...data,
      scheduleConfirmed: true,
      confirmedDateChipId: rp.dateChipId,
      confirmedPlaceChipId: rp.placeChipId,
      confirmedMovieChipId: rp.movieChipId,
    };
    if (sch) {
      nextLedgerDoc.scheduleDate = sch.scheduleDate;
      nextLedgerDoc.scheduleTime = sch.scheduleTime;
      nextLedgerDoc.scheduledAt = sch.scheduledAt;
    }
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextLedgerDoc) as Record<string, unknown>);
    notifyMeetingParticipantsOfHostActionFireAndForget(m, 'confirmed', uid);
    await grantMeetingConfirmXpIfLedger(uid, mid);
    return;
  }
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const data = snap.data() as Record<string, unknown>;
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
  const nsHost = normalizeParticipantId(uid) ?? uid;
  const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  if (!nsCreated || nsCreated !== nsHost) {
    throw new Error('모임 주관자만 일정을 확정할 수 있어요.');
  }
  const m = mapFirestoreMeetingDoc(snap.id, data);
  const analysis = computeMeetingConfirmAnalysis(m, hostTiePicks);
  if (!analysis.allReady) {
    throw new Error(analysis.firstBlock?.message ?? '투표 확정 조건을 만족하지 못했습니다.');
  }
  const rp = analysis.resolvedPicks;
  const schFs = scheduleFieldsAfterHostConfirm(m, rp.dateChipId);
  if (schFs) {
    const hostProf = await getUserProfile(uid);
    const buf = getScheduleOverlapBufferHours(hostProf);
    await assertNoConfirmedScheduleOverlapHybrid({
      appUserId: uid,
      startMs: schFs.scheduledAt.toMillis(),
      bufferHours: buf,
      excludeMeetingId: mid,
    });
  }
  const fsPatch: Record<string, unknown> = {
    scheduleConfirmed: true,
    confirmedDateChipId: rp.dateChipId,
    confirmedPlaceChipId: rp.placeChipId,
    confirmedMovieChipId: rp.movieChipId,
  };
  if (schFs) {
    fsPatch.scheduleDate = schFs.scheduleDate;
    fsPatch.scheduleTime = schFs.scheduleTime;
    fsPatch.scheduledAt = schFs.scheduledAt;
  }
  await updateDoc(ref, fsPatch);
  notifyMeetingParticipantsOfHostActionFireAndForget(m, 'confirmed', uid);
}

/** 주관자가 일정 확정을 되돌려 투표·확정 전 상태로 복구합니다. */
export async function unconfirmMeetingSchedule(meetingId: string, hostPhoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = hostPhoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 주관자 정보가 없습니다.');
  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsHost = normalizeParticipantId(uid) ?? uid;
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) {
      throw new Error('모임 주관자만 확정을 취소할 수 있어요.');
    }
    if (data.scheduleConfirmed !== true) {
      throw new Error('확정된 모임만 확정을 취소할 수 있어요.');
    }
    const m = mapFirestoreMeetingDoc(mid, data);
    await ledgerMeetingPutRawDoc(
      mid,
      stripUndefinedDeep({
        ...data,
        scheduleConfirmed: false,
        confirmedDateChipId: null,
        confirmedPlaceChipId: null,
        confirmedMovieChipId: null,
      }) as Record<string, unknown>,
    );
    notifyMeetingParticipantsOfHostActionFireAndForget(m, 'unconfirmed', uid);
    return;
  }
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const data = snap.data() as Record<string, unknown>;
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
  const nsHost = normalizeParticipantId(uid) ?? uid;
  const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  if (!nsCreated || nsCreated !== nsHost) {
    throw new Error('모임 주관자만 확정을 취소할 수 있어요.');
  }
  if (data.scheduleConfirmed !== true) {
    throw new Error('확정된 모임만 확정을 취소할 수 있어요.');
  }
  const m = mapFirestoreMeetingDoc(snap.id, data);
  await updateDoc(ref, {
    scheduleConfirmed: false,
    confirmedDateChipId: null,
    confirmedPlaceChipId: null,
    confirmedMovieChipId: null,
  });
  notifyMeetingParticipantsOfHostActionFireAndForget(m, 'unconfirmed', uid);
}

/** 주관자가 미확정 모임 문서를 삭제합니다. */
export async function deleteMeetingByHost(meetingId: string, hostPhoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = hostPhoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 주관자 정보가 없습니다.');
  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsHost = normalizeParticipantId(uid) ?? uid;
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) {
      throw new Error('모임 주관자만 삭제할 수 있어요.');
    }
    if (data.scheduleConfirmed === true) {
      throw new Error('일정이 확정된 모임은 먼저 확정을 취소한 뒤 삭제할 수 있어요.');
    }
    const m = mapFirestoreMeetingDoc(mid, data);
    notifyMeetingParticipantsOfHostActionFireAndForget(m, 'deleted', uid);
    await ledgerMeetingDelete(mid);
    return;
  }
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const data = snap.data() as Record<string, unknown>;
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
  const nsHost = normalizeParticipantId(uid) ?? uid;
  const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  if (!nsCreated || nsCreated !== nsHost) {
    throw new Error('모임 주관자만 삭제할 수 있어요.');
  }
  if (data.scheduleConfirmed === true) {
    throw new Error('일정이 확정된 모임은 먼저 확정을 취소한 뒤 삭제할 수 있어요.');
  }
  const m = mapFirestoreMeetingDoc(snap.id, data);
  notifyMeetingParticipantsOfHostActionFireAndForget(m, 'deleted', uid);
  await deleteDoc(ref);
}

/**
 * 회원 탈퇴 등: 주관자 검증 후 모임 문서만 삭제합니다.
 * 채팅 서브컬렉션·Storage는 호출 측에서 먼저 비운 뒤 호출하세요.
 * 확정 여부와 관계없이 삭제합니다.
 */
/** 주관자 확정 시 선택된 일시 칩 기준 대표 시각(ms). 후보 없으면 `meetingPrimaryStartMs`로 대체. */
export function meetingStartMsForResolvedDateChip(m: Meeting, dateChipId: string | null): number | null {
  if (!dateChipId?.trim()) return meetingPrimaryStartMs(m);
  const id = dateChipId.trim();
  const cands = m.dateCandidates ?? [];
  for (let i = 0; i < cands.length; i++) {
    const cid = cands[i].id?.trim() || `dc-${i}`;
    if (cid === id) {
      const inst = getDateCandidateScheduleInstant(cands[i]);
      return inst ? inst.getTime() : null;
    }
  }
  return meetingPrimaryStartMs(m);
}

function scheduleFieldsAfterHostConfirm(m: Meeting, dateChipId: string | null): {
  scheduleDate: string;
  scheduleTime: string;
  scheduledAt: Timestamp;
} | null {
  const ms = meetingStartMsForResolvedDateChip(m, dateChipId);
  if (ms == null) return null;
  const cands = m.dateCandidates ?? [];
  if (dateChipId?.trim() && cands.length > 0) {
    for (let i = 0; i < cands.length; i++) {
      const cid = cands[i].id?.trim() || `dc-${i}`;
      if (cid === dateChipId.trim()) {
        const prim = primaryScheduleFromDateCandidate(cands[i]);
        const ts = parseScheduleToTimestamp(prim.scheduleDate, prim.scheduleTime);
        if (ts) return { scheduleDate: prim.scheduleDate, scheduleTime: prim.scheduleTime, scheduledAt: ts };
        return { scheduleDate: prim.scheduleDate, scheduleTime: prim.scheduleTime, scheduledAt: Timestamp.fromMillis(ms) };
      }
    }
  }
  const d = new Date(ms);
  return {
    scheduleDate: fmtDateYmd(d),
    scheduleTime: fmtTimeHm(d),
    scheduledAt: Timestamp.fromMillis(ms),
  };
}

/** 모임 대표 일시(상단 `scheduledAt` 또는 scheduleDate+scheduleTime)의 epoch ms. 없으면 null. */
export function meetingPrimaryStartMs(m: Pick<Meeting, 'scheduledAt' | 'scheduleDate' | 'scheduleTime'>): number | null {
  const ts = m.scheduledAt;
  if (ts != null && typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  const d = m.scheduleDate?.trim() ?? '';
  const t = m.scheduleTime?.trim() ?? '';
  const parsed = parseScheduleToTimestamp(d, t);
  return parsed ? parsed.toMillis() : null;
}

const SEOUL_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 한국(서울) 달력 기준 오늘의 `YYYY-MM-DD` */
function todayYmdSeoul(): string {
  return SEOUL_YMD.format(new Date());
}

/**
 * 대표 일시가 한국(서울) 달력 기준 «오늘»인지.
 * `scheduleDate`가 `YYYY-MM-DD`면 그 문자열과 비교하고, 아니면 `meetingPrimaryStartMs`로 판별합니다.
 */
export function isMeetingScheduledTodaySeoul(
  m: Pick<Meeting, 'scheduledAt' | 'scheduleDate' | 'scheduleTime'>,
): boolean {
  const today = todayYmdSeoul();
  const d = (m.scheduleDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d === today;
  }
  const ms = meetingPrimaryStartMs(m);
  if (ms == null) return false;
  return SEOUL_YMD.format(new Date(ms)) === today;
}

/**
 * 공개·미확정이며 대표 일시가 이미 지난 모임을 주관자 세션에서 삭제합니다.
 * 참가자에게는 `auto_cancelled_unconfirmed` 푸시가 발송됩니다.
 */
export async function autoExpireStalePublicUnconfirmedMeetingAsHost(
  meetingId: string,
  hostPhoneUserId: string,
): Promise<boolean> {
  const mid = meetingId.trim();
  const uid = hostPhoneUserId.trim();
  if (!mid || !uid) return false;
  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) return false;
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsHost = normalizeParticipantId(uid) ?? uid;
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) return false;
    if (data.isPublic !== true) return false;
    if (data.scheduleConfirmed === true) return false;
    const m = mapFirestoreMeetingDoc(mid, data);
    const startMs = meetingPrimaryStartMs(m);
    if (startMs == null || Date.now() < startMs) return false;
    notifyMeetingParticipantsOfHostActionFireAndForget(m, 'auto_cancelled_unconfirmed', uid);
    await ledgerMeetingDelete(mid);
    return true;
  }
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data() as Record<string, unknown>;
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
  const nsHost = normalizeParticipantId(uid) ?? uid;
  const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  if (!nsCreated || nsCreated !== nsHost) return false;
  if (data.isPublic !== true) return false;
  if (data.scheduleConfirmed === true) return false;

  const m = mapFirestoreMeetingDoc(snap.id, data);
  const startMs = meetingPrimaryStartMs(m);
  if (startMs == null || Date.now() < startMs) return false;

  notifyMeetingParticipantsOfHostActionFireAndForget(m, 'auto_cancelled_unconfirmed', uid);
  await deleteDoc(ref);
  return true;
}

export async function deleteMeetingDocumentByHostForce(meetingId: string, hostPhoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = hostPhoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 주관자 정보가 없습니다.');
  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsHost = normalizeParticipantId(uid) ?? uid;
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsHost) {
      throw new Error('모임 주관자만 삭제할 수 있어요.');
    }
    const m = mapFirestoreMeetingDoc(mid, data);
    notifyMeetingParticipantsOfHostActionFireAndForget(m, 'deleted', uid);
    await ledgerMeetingDelete(mid);
    return;
  }
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const data = snap.data() as Record<string, unknown>;
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
  const nsHost = normalizeParticipantId(uid) ?? uid;
  const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
  if (!nsCreated || nsCreated !== nsHost) {
    throw new Error('모임 주관자만 삭제할 수 있어요.');
  }
  const m = mapFirestoreMeetingDoc(snap.id, data);
  notifyMeetingParticipantsOfHostActionFireAndForget(m, 'deleted', uid);
  await deleteDoc(ref);
}

/**
 * 회원 탈퇴 등: 모임 주관자(createdBy)를 다른 참여자에게 이관합니다.
 * - 참여자가 2명 이상인 모임에서만 호출하세요.
 * - 확정 여부와 무관하게 createdBy만 갱신합니다(이관 후 탈퇴는 leaveMeeting로 처리).
 */
export async function transferMeetingHost(meetingId: string, currentHostUserId: string, nextHostUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const cur = currentHostUserId.trim();
  const next = nextHostUserId.trim();
  if (!mid || !cur || !next) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsCur = normalizeParticipantId(cur) ?? cur;
  const nsNext = normalizeParticipantId(next) ?? next;
  if (nsCur === nsNext) throw new Error('다음 방장이 유효하지 않습니다.');

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsCur) {
      throw new Error('모임 주관자만 방장을 이관할 수 있어요.');
    }
    // participantIds에 next가 없더라도 createdBy는 이관(이후 참여자 목록/권한은 별도 정책으로 정리)
    const nextDoc = stripUndefinedDeep({
      ...data,
      createdBy: next,
    }) as Record<string, unknown>;
    await ledgerMeetingPutRawDoc(
      mid,
      nextDoc,
    );
    const after = mapFirestoreMeetingDoc(mid, nextDoc);
    notifyMeetingNewHostAssignedFireAndForget(after, next);
    return;
  }

  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  let before: Record<string, unknown> | null = null;
  await runTransaction(getFirestoreDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    before = data;
    const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
    const nsCreated = createdBy ? normalizeParticipantId(createdBy) ?? createdBy : '';
    if (!nsCreated || nsCreated !== nsCur) {
      throw new Error('모임 주관자만 방장을 이관할 수 있어요.');
    }
    tx.update(ref, { createdBy: next });
  });
  if (before != null) {
    const mergedHostTransfer = Object.assign({}, before, { createdBy: next }) as Record<string, unknown>;
    const after = mapFirestoreMeetingDoc(mid, stripUndefinedDeep(mergedHostTransfer) as Record<string, unknown>);
    notifyMeetingNewHostAssignedFireAndForget(after, next);
  }
}

function collectCreateMeetingProposedStartMs(input: CreateMeetingInput): number[] {
  const set = new Set<number>();
  const prim = parseScheduleToTimestamp(input.scheduleDate, input.scheduleTime);
  if (prim) set.add(prim.toMillis());
  for (const c of input.dateCandidates ?? []) {
    const inst = getDateCandidateScheduleInstant(c);
    if (inst && Number.isFinite(inst.getTime())) set.add(inst.getTime());
  }
  return [...set];
}

export async function addMeeting(input: CreateMeetingInput): Promise<string> {
  const primaryErr = validatePrimaryScheduleForSave(input.scheduleDate, input.scheduleTime);
  if (primaryErr) throw new Error(primaryErr);
  if (input.dateCandidates?.length) {
    const candErr = validateDateCandidatesForSave(input.dateCandidates);
    if (candErr) throw new Error(candErr);
  }
  const scheduledAt = parseScheduleToTimestamp(input.scheduleDate, input.scheduleTime);

  const capacity = toFiniteInt(input.capacity, MEETING_PARTICIPANT_MIN);
  const minParticipants =
    input.minParticipants === undefined || input.minParticipants === null
      ? null
      : toFiniteInt(input.minParticipants, MEETING_PARTICIPANT_MIN);

  const lat = Number(input.latitude);
  const lng = Number(input.longitude);

  const docFields: Record<string, unknown> = {
    title: input.title.trim(),
    location: input.location.trim(),
    placeName: input.placeName.trim(),
    address: input.address.trim(),
    latitude: Number.isFinite(lat) ? lat : 0,
    longitude: Number.isFinite(lng) ? lng : 0,
    description: input.description.trim(),
    capacity,
    minParticipants,
    createdBy: input.createdBy?.trim() ? input.createdBy.trim() : null,
    imageUrl: input.imageUrl?.trim() ? input.imageUrl.trim() : null,
    categoryId: String(input.categoryId),
    categoryLabel: input.categoryLabel.trim(),
    isPublic: Boolean(input.isPublic),
    scheduleDate: input.scheduleDate.trim(),
    scheduleTime: input.scheduleTime.trim(),
    scheduledAt: scheduledAt ?? null,
    placeCandidates: input.placeCandidates?.length
      ? stripUndefinedDeep(input.placeCandidates)
      : null,
    dateCandidates: input.dateCandidates?.length ? stripUndefinedDeep(input.dateCandidates) : null,
    extraData: input.extraData != null ? stripUndefinedDeep(input.extraData) : null,
    meetingConfig: input.meetingConfig != null ? stripUndefinedDeep(input.meetingConfig) : null,
    participantIds: input.createdBy?.trim() ? [input.createdBy.trim()] : [],
    scheduleConfirmed: false,
  };

  const cleaned = stripUndefinedDeep(docFields) as Record<string, unknown>;

  const hostPk = input.createdBy?.trim();
  if (!hostPk) throw new Error('주최자 정보가 없습니다.');

  if (ledgerWritesToSupabase()) {
    const hay = [input.address, input.placeName].filter(Boolean).join(' ');
    const feedNorm = feedRegionNormFromAddressHaystack(hay);
    if (feedNorm) cleaned.feedRegionNorm = feedNorm;
  }
  const hostProf = await getUserProfile(hostPk);
  if (!hostProf || !isMeetingServiceComplianceComplete(hostProf, hostPk)) {
    throw new Error('모임 이용 인증(약관 동의·필수 정보)을 완료한 사용자만 모임을 만들 수 있어요. 설정에서 인증 정보 등록을 완료해 주세요.');
  }
  const buf = getScheduleOverlapBufferHours(hostProf);
  const starts = collectCreateMeetingProposedStartMs(input);
  if (starts.length > 0) {
    await assertProposedStartsOverlapHybrid({
      appUserId: hostPk,
      startMsList: starts,
      bufferHours: buf,
      excludeMeetingId: null,
    });
  }

  if (ledgerWritesToSupabase()) {
    return ledgerMeetingCreate(hostPk, cleaned);
  }

  if (cleaned.isPublic === true) {
    ginitNotifyDbg('meeting-created-notify', 'skip_no_supabase_ledger', {
      hint: 'EXPO_PUBLIC_LEDGER_WRITES=firestore 이거나 SUPABASE URL/ANON 미설정 시 Edge 호출 없음',
    });
  }

  console.log('Final Firestore Payload:', toJsonSafeFirestorePreview({ ...cleaned, createdAt: '[serverTimestamp]' }));

  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);
  const created = await addDoc(ref, {
    ...cleaned,
    createdAt: serverTimestamp(),
  });
  return created.id;
}

/** 모임 목록 일회 조회(당겨서 새로고침 등). `subscribeMeetings`와 동일 쿼리·매핑. */
export async function fetchMeetingsOnce(): Promise<{ ok: true; meetings: Meeting[] } | { ok: false; message: string }> {
  try {
    const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);
    const q = query(ref, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list: Meeting[] = snap.docs.map((d) =>
      mapFirestoreMeetingDoc(d.id, d.data() as Record<string, unknown>),
    );
    return { ok: true, meetings: list };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Firestore 조회 오류';
    return { ok: false, message };
  }
}

export function subscribeMeetings(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);
  const q = query(ref, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: Meeting[] = snap.docs.map((d) =>
        mapFirestoreMeetingDoc(d.id, d.data() as Record<string, unknown>),
      );
      onData(list);
    },
    (err) => {
      onError?.(err.message ?? 'Firestore 구독 오류');
    },
  );
}
