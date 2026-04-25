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

import { stripUndefinedDeep, toFiniteInt, toJsonSafeFirestorePreview } from './firestore-utils';
import { getFirebaseFirestore } from './firebase';
import { ledgerWritesToSupabase } from './hybrid-data-source';
import {
  isLedgerMeetingId,
  ledgerMeetingCreate,
  ledgerMeetingDelete,
  ledgerMeetingPutRawDoc,
  ledgerTryLoadMeetingDoc,
} from './meetings-ledger';
import { notifyMeetingParticipantsOfHostActionFireAndForget } from './meeting-host-push-notify';
import type { MeetingExtraData, SelectedMovieExtra } from './meeting-extra-data';
import {
  fmtDateYmd,
  fmtTimeHm,
  getDateCandidateScheduleInstant,
  primaryScheduleFromDateCandidate,
  validateDateCandidatesForSave,
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
import { getUserProfile, isUserPhoneVerified, type UserProfile } from './user-profile';

export const MEETINGS_COLLECTION = 'meetings';

/** `GlassDualCapacityWheel` 의 무제한 정원 값(999)과 동일해야 합니다. */
export const MEETING_CAPACITY_UNLIMITED = 999;

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
};

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

type PlaceCandidateLike = { id: string; placeName: string; address: string; latitude: number; longitude: number };

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
    const emit = () => {
      if (cancelled) return;
      void ledgerTryLoadMeetingDoc(id).then((data) => {
        if (cancelled) return;
        if (!data) onMeeting(null);
        else onMeeting(mapFirestoreMeetingDoc(id, data));
      });
    };
    emit();
    const topic = `meetings-ledger:${id}:${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter: `id=eq.${id}` }, () => {
        emit();
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') onError?.('Supabase Realtime 연결 오류');
      });
    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
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
): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  const dateErr = validateDateCandidatesForSave(dateCandidates);
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
  if (!isUserPhoneVerified(profile)) {
    throw new Error('전화번호 인증을 완료한 사용자만 모임에 참여할 수 있어요. 프로필에서 인증을 진행해 주세요.');
  }

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const joinBlock = getJoinGamificationBlockReason(profile, data);
    if (joinBlock) throw new Error(joinBlock);
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
    return;
  }

  const preSnap = await getDoc(ref);
  if (!preSnap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const joinBlock = getJoinGamificationBlockReason(profile, preSnap.data() as Record<string, unknown>);
  if (joinBlock) throw new Error(joinBlock);
  const mPreFs = mapFirestoreMeetingDoc(mid, preSnap.data() as Record<string, unknown>);
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

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizeParticipantId(x) ?? x.trim()) === nsUid);
    if (inList) {
      return;
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
  if (!isUserPhoneVerified(profile)) {
    throw new Error('전화번호 인증을 완료한 사용자만 모임에서 투표할 수 있어요. 프로필에서 인증을 진행해 주세요.');
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
    if (removeToken) {
      patch.participantIds = rawList.filter((x) => x !== removeToken);
    }
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(patch) as Record<string, unknown>);
    return;
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
    if (removeToken) {
      patch.participantIds = arrayRemove(removeToken);
    }
    transaction.update(ref, patch);
  });
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

  const capacity = toFiniteInt(input.capacity, 1);
  const minParticipants =
    input.minParticipants === undefined || input.minParticipants === null
      ? null
      : toFiniteInt(input.minParticipants, 1);

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
  if (hostPk) {
    const hostProf = await getUserProfile(hostPk);
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
  }

  if (ledgerWritesToSupabase()) {
    const host = input.createdBy?.trim();
    if (!host) throw new Error('주최자 정보가 없습니다.');
    return ledgerMeetingCreate(host, cleaned);
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
