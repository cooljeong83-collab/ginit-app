/**
 * Firestore `meetings` 컬렉션.
 *
 * `createdBy`는 **정규화된 전화번호 PK**(+8210…) 문자열로 저장됩니다. (Firebase UID와 다를 수 있음)
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
  doc,
  getDoc,
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
import type { MeetingExtraData } from './meeting-extra-data';
import type { DateCandidate } from './meeting-place-bridge';
import { normalizePhoneUserId } from './phone-user-id';

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
};

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
};

/** `YYYY-MM-DD` + `H:mm` 또는 `HH:mm` → Firestore Timestamp (파싱 실패 시 null). */
export function parseScheduleToTimestamp(dateStr: string, timeStr: string): Timestamp | null {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const dt = new Date(`${d}T${hh}:${mm}:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return Timestamp.fromDate(dt);
}

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
  const ns = normalizePhoneUserId(phoneUserId.trim()) ?? phoneUserId.trim();
  const log = meeting.participantVoteLog ?? [];
  return log.find((e) => (normalizePhoneUserId(e.userId) ?? e.userId.trim()) === ns) ?? null;
}

function countDistinctMeetingParticipants(m: Meeting): number {
  const hostRaw = m.createdBy?.trim() ?? '';
  const host = hostRaw ? normalizePhoneUserId(hostRaw) ?? hostRaw : '';
  const listRaw = m.participantIds ?? [];
  const seen = new Set<string>();
  if (host) seen.add(host);
  for (const x of listRaw) {
    const id = normalizePhoneUserId(String(x)) ?? String(x).trim();
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

function mapFirestoreMeetingDoc(id: string, data: Record<string, unknown>): Meeting {
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
  };
}

export async function getMeetingById(meetingId: string): Promise<Meeting | null> {
  const id = meetingId.trim();
  if (!id) return null;
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
  const id = meetingId.trim();
  if (!id) {
    onMeeting(null);
    return () => {};
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
  await updateDoc(doc(getFirestoreDb(), MEETINGS_COLLECTION, id), {
    dateCandidates: dateCandidates.length ? stripUndefinedDeep(dateCandidates) : null,
  });
}

type PlaceCandidateDoc = NonNullable<Meeting['placeCandidates']>[number];

/** 장소 후보만 갱신 (상세 화면 장소 제안 등) */
export async function updateMeetingPlaceCandidates(
  meetingId: string,
  placeCandidates: PlaceCandidateDoc[],
): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  await updateDoc(doc(getFirestoreDb(), MEETINGS_COLLECTION, id), {
    placeCandidates: placeCandidates.length ? stripUndefinedDeep(placeCandidates) : null,
  });
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
  const nsUid = normalizePhoneUserId(uid) ?? uid;

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizePhoneUserId(x) ?? x.trim()) === nsUid);
    if (inList) {
      return;
    }
    const prev = parseVoteTalliesField(data) ?? {};
    const dates = mergeTallyIncrement(prev.dates, votes.dateChipIds);
    const places = mergeTallyIncrement(prev.places, votes.placeChipIds);
    const movies = mergeTallyIncrement(prev.movies, votes.movieChipIds);

    const log = parseParticipantVoteLog(data);
    const filtered = log.filter((e) => (normalizePhoneUserId(e.userId) ?? e.userId.trim()) !== nsUid);
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
  const nsUid = normalizePhoneUserId(uid) ?? uid;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const inList = rawList.some((x) => (normalizePhoneUserId(x) ?? x.trim()) === nsUid);
    if (!inList) throw new Error('참여 중인 모임만 투표를 수정할 수 있어요.');

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizePhoneUserId(e.userId) ?? e.userId.trim()) === nsUid);
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
      ...log.filter((e) => (normalizePhoneUserId(e.userId) ?? e.userId.trim()) !== nsUid),
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
export async function leaveMeeting(meetingId: string, phoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = phoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 사용자 정보가 없습니다.');
  const nsUid = normalizePhoneUserId(uid) ?? uid;
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);

  await runTransaction(getFirestoreDb(), async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
    const data = snap.data() as Record<string, unknown>;
    const rawList = Array.isArray(data.participantIds)
      ? (data.participantIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let removeToken: string | null = null;
    for (const x of rawList) {
      if ((normalizePhoneUserId(x) ?? x.trim()) === nsUid) {
        removeToken = x;
        break;
      }
    }

    const log = parseParticipantVoteLog(data);
    const old = log.find((e) => (normalizePhoneUserId(e.userId) ?? e.userId.trim()) === nsUid);
    const oldD = old?.dateChipIds ?? [];
    const oldP = old?.placeChipIds ?? [];
    const oldM = old?.movieChipIds ?? [];

    const vt = parseVoteTalliesField(data) ?? {};
    const dates = old ? mergeTallyDecrement({ ...vt.dates }, oldD) : { ...vt.dates };
    const places = old ? mergeTallyDecrement({ ...vt.places }, oldP) : { ...vt.places };
    const movies = old ? mergeTallyDecrement({ ...vt.movies }, oldM) : { ...vt.movies };
    const nextLog = log.filter((e) => (normalizePhoneUserId(e.userId) ?? e.userId.trim()) !== nsUid);

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

/** 모임 주관자가 일정·모집 상태를 확정 처리 */
export async function confirmMeetingSchedule(meetingId: string, hostPhoneUserId: string): Promise<void> {
  const mid = meetingId.trim();
  const uid = hostPhoneUserId.trim();
  if (!mid || !uid) throw new Error('모임 또는 주관자 정보가 없습니다.');
  const ref = doc(getFirestoreDb(), MEETINGS_COLLECTION, mid);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('모임을 찾을 수 없어요.');
  const data = snap.data() as Record<string, unknown>;
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy.trim() : '';
  const nsHost = normalizePhoneUserId(uid) ?? uid;
  const nsCreated = createdBy ? normalizePhoneUserId(createdBy) ?? createdBy : '';
  if (!nsCreated || nsCreated !== nsHost) {
    throw new Error('모임 주관자만 일정을 확정할 수 있어요.');
  }
  await updateDoc(ref, { scheduleConfirmed: true });
}

export async function addMeeting(input: CreateMeetingInput): Promise<void> {
  const scheduledAt = parseScheduleToTimestamp(input.scheduleDate, input.scheduleTime);
  const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);

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
    participantIds: input.createdBy?.trim() ? [input.createdBy.trim()] : [],
    scheduleConfirmed: false,
  };

  const cleaned = stripUndefinedDeep(docFields) as Record<string, unknown>;

  console.log('Final Firestore Payload:', toJsonSafeFirestorePreview({ ...cleaned, createdAt: '[serverTimestamp]' }));

  await addDoc(ref, {
    ...cleaned,
    createdAt: serverTimestamp(),
  });
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
