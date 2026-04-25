import { publicEnv } from '@/src/config/public-env';
import { isSupabaseRpcMissingOrStaleSchema } from '@/src/lib/supabase-rpc-schema';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getPolicyNumeric } from '@/src/lib/app-policies-store';
import { getDateCandidateScheduleInstant } from '@/src/lib/date-candidate';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import type { DateCandidate } from '@/src/lib/meeting-place-bridge';
import {
  meetingScheduleStartMs,
  parseScheduleToTimestamp,
  type MeetingScheduleTimeFields,
} from '@/src/lib/meeting-schedule-times';
import { supabase } from '@/src/lib/supabase';
import type { UserProfile } from '@/src/lib/user-profile';

/** 일정 겹침에 쓰는 최소 필드(`meetings.Meeting`과 구조 호환, meetings.ts 미참조). */
export type MeetingScheduleOverlapDoc = MeetingScheduleTimeFields & {
  id: string;
  createdBy?: string | null;
  participantIds?: string[] | null;
  scheduleConfirmed?: boolean | null;
  dateCandidates?: DateCandidate[] | null;
};

/** `loadOverlapMeetingScans` 결과 — 확정·미확정 후보 슬롯 집계에 사용 */
export type OverlapMeetingScan = {
  id: string;
  scheduleConfirmed: boolean;
  primaryStartMs: number | null;
  dateCandidates: DateCandidate[];
  createdBy?: string | null;
  participantIds?: string[] | null;
};

/** `joined-meetings`와 동일 규칙 — 해당 모듈을 import 하지 않아 순환 참조를 피합니다. */
function isUserJoinedMeetingForScheduleOverlap(
  m: Pick<MeetingScheduleOverlapDoc, 'createdBy' | 'participantIds'>,
  userId: string | null | undefined,
): boolean {
  if (!userId?.trim()) return false;
  const u = normalizeParticipantId(userId.trim());
  const hostRaw = m.createdBy?.trim() ?? '';
  if (hostRaw) {
    const host = normalizeParticipantId(hostRaw);
    if (host === u) return true;
  }
  for (const id of m.participantIds ?? []) {
    if (normalizeParticipantId(String(id)) === u) return true;
  }
  return false;
}

/** Lv.4+ & 높은 gTrust 시 버퍼 완화 */
export const OVERLAP_RELAX_G_LEVEL_MIN = 4;
export const OVERLAP_RELAX_G_TRUST_MIN = 80;

/** 레거시·테스트용 — 런타임 문구는 `overlapThrowMessageForHours` 사용 */
export const OVERLAP_CONFLICT_MESSAGE_3H = '이미 해당 시간대 근처(3시간 이내)에 다른 확정된 약속이 있습니다.';
export const OVERLAP_CONFLICT_MESSAGE_2H = '이미 해당 시간대 근처(2시간 이내)에 다른 확정된 약속이 있습니다.';

export const GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION =
  '지닛이 확인해보니 이때는 이동 시간이 부족할 것 같아요! 다른 시간대의 모임을 찾아볼까요?';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 일정 겹침 버퍼(시간). 기본값은 `app_policies` meeting.overlap_hours(캐시)이며,
 * Lv.4+ & gTrust 80+ 구간은 제품상 2시간으로 완화합니다.
 */
export function getScheduleOverlapBufferHours(profile: UserProfile | null | undefined): number {
  const baseRaw = getPolicyNumeric('meeting', 'overlap_hours', 3);
  const base = Math.max(1, Math.min(168, Math.round(Number(baseRaw)) || 3));
  const lv =
    typeof profile?.gLevel === 'number' && Number.isFinite(profile.gLevel) ? Math.floor(profile.gLevel) : 1;
  const trust =
    typeof profile?.gTrust === 'number' && Number.isFinite(profile.gTrust) ? Math.floor(profile.gTrust) : 0;
  if (lv >= OVERLAP_RELAX_G_LEVEL_MIN && trust >= OVERLAP_RELAX_G_TRUST_MIN) return 2;
  return base;
}

export function isUuidMeetingIdForOverlap(id: string): boolean {
  return UUID_V4_RE.test(id.trim());
}

export function isConfirmedScheduleOverlapErrorMessage(message: string): boolean {
  return message.includes('확정된 약속이 있습니다');
}

export function overlapThrowMessageForHours(bufferHours: number): string {
  const h = Math.max(1, Math.round(Number(bufferHours)) || 1);
  return `이미 해당 시간대 근처(${h}시간 이내)에 다른 확정된 약속이 있습니다.`;
}

function overlapThrowMessage(bufferHours: number): string {
  const h = Math.round(Number(bufferHours)) || 2;
  if (h <= 2) return OVERLAP_CONFLICT_MESSAGE_2H;
  return overlapThrowMessageForHours(bufferHours);
}

function normalizeRpcOverlapError(raw: string, bufferHours: number): string {
  if (raw.includes('확정된 약속이 있습니다')) {
    const m = /(\d+)\s*시간\s*이내/.exec(raw);
    if (m) {
      const parsed = Number.parseInt(m[1], 10);
      if (Number.isFinite(parsed)) return overlapThrowMessageForHours(parsed);
    }
    return overlapThrowMessage(bufferHours);
  }
  return raw;
}

function collectSlotTimesFromOverlapScan(x: OverlapMeetingScan): number[] {
  const out = new Set<number>();
  if (x.scheduleConfirmed) {
    if (x.primaryStartMs != null && Number.isFinite(x.primaryStartMs)) out.add(x.primaryStartMs);
    return [...out];
  }
  for (const c of x.dateCandidates) {
    const inst = getDateCandidateScheduleInstant(c);
    if (inst && Number.isFinite(inst.getTime())) out.add(inst.getTime());
  }
  if (x.primaryStartMs != null && Number.isFinite(x.primaryStartMs)) out.add(x.primaryStartMs);
  return [...out];
}

/** 로드된 모임 스캔 목록 기준 — 확정 일정 + 미확정 후보 일시가 버퍼 안에 겹치면 true */
export function proposalOverlapsLoadedScans(
  scans: readonly OverlapMeetingScan[],
  appUserId: string,
  proposedStartMs: number,
  bufferHours: number,
  excludeMeetingId: string | null | undefined,
): boolean {
  const uid = appUserId.trim();
  if (!uid || !Number.isFinite(proposedStartMs)) return false;
  const bufMs = bufferHours * 60 * 60 * 1000;
  const ex = excludeMeetingId?.trim() ?? '';
  for (const x of scans) {
    if (!isUserJoinedMeetingForScheduleOverlap(x, uid)) continue;
    if (ex && x.id === ex) continue;
    for (const sm of collectSlotTimesFromOverlapScan(x)) {
      if (Math.abs(sm - proposedStartMs) <= bufMs) return true;
    }
  }
  return false;
}

function scanFromFirestoreMeeting(m: {
  id: string;
  scheduleConfirmed?: boolean | null;
  scheduledAt?: unknown;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
  dateCandidates?: unknown;
  createdBy?: string | null;
  participantIds?: unknown;
}): OverlapMeetingScan {
  const dc = Array.isArray(m.dateCandidates) ? (m.dateCandidates as DateCandidate[]) : [];
  return {
    id: m.id,
    scheduleConfirmed: m.scheduleConfirmed === true,
    primaryStartMs: meetingScheduleStartMs({
      scheduledAt: m.scheduledAt,
      scheduleDate: m.scheduleDate,
      scheduleTime: m.scheduleTime,
    }),
    dateCandidates: dc,
    createdBy: typeof m.createdBy === 'string' ? m.createdBy : null,
    participantIds: Array.isArray(m.participantIds)
      ? (m.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : null,
  };
}

function ledgerOverlapRowToScan(row: Record<string, unknown>): OverlapMeetingScan | null {
  const idRaw = row.meeting_id ?? row.meetingId;
  const id = idRaw != null ? String(idRaw).trim() : '';
  if (!id) return null;
  const fs = (row.fs_doc ?? row.fsDoc ?? {}) as Record<string, unknown>;
  const dc = Array.isArray(fs.dateCandidates) ? (fs.dateCandidates as DateCandidate[]) : [];
  let primaryStartMs: number | null = null;
  const sat = row.scheduled_at ?? row.scheduledAt;
  if (sat != null) {
    const d = new Date(String(sat));
    if (Number.isFinite(d.getTime())) primaryStartMs = d.getTime();
  }
  if (primaryStartMs == null) {
    const sd = typeof row.schedule_date === 'string' ? row.schedule_date : typeof row.scheduleDate === 'string' ? row.scheduleDate : '';
    const st = typeof row.schedule_time === 'string' ? row.schedule_time : typeof row.scheduleTime === 'string' ? row.scheduleTime : '';
    const ts = parseScheduleToTimestamp(sd.trim(), st.trim());
    primaryStartMs = ts ? ts.toMillis() : null;
  }
  const sch = row.schedule_confirmed ?? row.scheduleConfirmed;
  return {
    id,
    scheduleConfirmed: sch === true,
    primaryStartMs,
    dateCandidates: dc,
    createdBy: typeof fs.createdBy === 'string' ? fs.createdBy : null,
    participantIds: Array.isArray(fs.participantIds)
      ? (fs.participantIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : null,
  };
}

/** 참여 중 모임 스냅샷 — 레저 모드에서는 Supabase RPC, 그 외 Firestore 전체 목록 */
export async function loadOverlapMeetingScans(appUserId: string): Promise<OverlapMeetingScan[]> {
  const uid = appUserId.trim();
  if (!uid) return [];

  if (ledgerWritesToSupabase()) {
    if (!publicEnv.supabaseUrl?.trim() || !publicEnv.supabaseAnonKey?.trim()) return [];
    const { data, error } = await supabase.rpc('ledger_list_my_meetings_for_overlap', {
      p_app_user_id: uid,
    });
    if (error) {
      if (isSupabaseRpcMissingOrStaleSchema(error.message)) {
        if (__DEV__) {
          console.warn(
            '[meeting-schedule-overlap] ledger_list_my_meetings_for_overlap unavailable; falling back to Firestore list.',
            error.message,
          );
        }
        const { fetchMeetingsOnce } = await import('@/src/lib/meetings');
        const fr = await fetchMeetingsOnce();
        if (!fr.ok) return [];
        return fr.meetings.map((m) => scanFromFirestoreMeeting(m));
      }
      throw new Error(error.message);
    }
    const rows = Array.isArray(data) ? data : [];
    const out: OverlapMeetingScan[] = [];
    for (const raw of rows) {
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const s = ledgerOverlapRowToScan(raw as Record<string, unknown>);
        if (s) out.push(s);
      }
    }
    return out;
  }

  const { fetchMeetingsOnce } = await import('@/src/lib/meetings');
  const fr = await fetchMeetingsOnce();
  if (!fr.ok) return [];
  return fr.meetings.map((m) => scanFromFirestoreMeeting(m));
}

/**
 * 모임 만들기·일정 후보 UI — 다른 참여 약속과의 겹침 검사 시 사용하는 버퍼(시간).
 * (`getScheduleOverlapBufferHours` 정책 완화와 별도로 후보 입력 단계에서는 3시간 고정)
 */
export const DATE_CANDIDATE_OVERLAP_BUFFER_HOURS = 3;

export function collectScheduleInstantMsFromDateCandidates(candidates: readonly DateCandidate[]): number[] {
  const raw: number[] = [];
  for (const c of candidates) {
    const inst = getDateCandidateScheduleInstant(c);
    if (inst && Number.isFinite(inst.getTime())) raw.push(inst.getTime());
  }
  return [...new Set(raw)];
}

/** 일시 후보 목록의 각 대표 시각이, 다른 모임 약속과 ±bufferHours 이내로 겹치면 throw */
export async function assertDateCandidatesNoOverlapWithOtherMeetings(opts: {
  appUserId: string | null | undefined;
  candidates: readonly DateCandidate[];
  bufferHours: number;
  excludeMeetingId?: string | null;
}): Promise<void> {
  const uid = opts.appUserId?.trim() ?? '';
  if (!uid) return;
  const starts = collectScheduleInstantMsFromDateCandidates(opts.candidates);
  if (starts.length === 0) return;
  await assertProposedStartsOverlapHybrid({
    appUserId: uid,
    startMsList: starts,
    bufferHours: opts.bufferHours,
    excludeMeetingId: opts.excludeMeetingId ?? null,
  });
}

/**
 * 여러 제안 시각 각각에 대해 Postgres(RPC, 확정만) + 로컬 스캔(확정·미확정 후보).
 * 동일 모임(`excludeMeetingId`) 소속 슬롯은 제외합니다.
 */
export async function assertProposedStartsOverlapHybrid(opts: {
  appUserId: string;
  startMsList: readonly number[];
  bufferHours: number;
  excludeMeetingId?: string | null;
}): Promise<void> {
  const { appUserId, bufferHours, excludeMeetingId } = opts;
  const uid = appUserId.trim();
  const uniq = [...new Set(opts.startMsList.filter((t): t is number => Number.isFinite(t)))];
  if (!uid || uniq.length === 0) return;

  const excludeUuid =
    excludeMeetingId?.trim() && isUuidMeetingIdForOverlap(excludeMeetingId) ? excludeMeetingId.trim() : null;

  const scans = await loadOverlapMeetingScans(uid);

  for (const startMs of uniq) {
    const iso = new Date(startMs).toISOString();
    if (publicEnv.supabaseUrl?.trim() && publicEnv.supabaseAnonKey?.trim()) {
      const { error } = await supabase.rpc('assert_no_confirmed_schedule_overlap', {
        p_app_user_id: uid,
        p_start: iso,
        p_buffer_hours: bufferHours,
        p_exclude_meeting_id: excludeUuid,
      });
      if (error) {
        if (isSupabaseRpcMissingOrStaleSchema(error.message)) {
          if (__DEV__) {
            console.warn(
              '[meeting-schedule-overlap] assert_no_confirmed_schedule_overlap unavailable; using client-side scans only.',
              error.message,
            );
          }
        } else {
          throw new Error(normalizeRpcOverlapError(error.message, bufferHours));
        }
      }
    }

    if (proposalOverlapsLoadedScans(scans, uid, startMs, bufferHours, excludeMeetingId)) {
      throw new Error(overlapThrowMessage(bufferHours));
    }
  }
}

/**
 * Firestore 전체 모임 스캔 — 레저(SQL)에만 있는 모임은 `skipLedgerIds`로 제외(RPC가 담당).
 */
export function findFirestoreConfirmedOverlap(
  meetings: readonly MeetingScheduleOverlapDoc[],
  appUserId: string,
  proposedStartMs: number,
  bufferHours: number,
  excludeMeetingId: string | null | undefined,
  skipLedgerIds: boolean,
): boolean {
  const uid = appUserId.trim();
  if (!uid || !Number.isFinite(proposedStartMs)) return false;
  const bufMs = bufferHours * 60 * 60 * 1000;
  const ex = excludeMeetingId?.trim() ?? '';
  for (const m of meetings) {
    if (ex && m.id === ex) continue;
    if (skipLedgerIds && isLedgerMeetingId(m.id)) continue;
    if (m.scheduleConfirmed !== true) continue;
    if (!isUserJoinedMeetingForScheduleOverlap(m, uid)) continue;
    const t = meetingScheduleStartMs(m);
    if (t == null) continue;
    if (Math.abs(t - proposedStartMs) <= bufMs) return true;
  }
  return false;
}

/**
 * Postgres(RPC, 확정) + 로컬 스캔(확정·미확정 후보). `meetings.ts`와의 순환 참조를 피하기 위해 동적 import는 하위에서 사용합니다.
 */
export async function assertNoConfirmedScheduleOverlapHybrid(opts: {
  appUserId: string;
  startMs: number;
  bufferHours: number;
  excludeMeetingId?: string | null;
}): Promise<void> {
  const { appUserId, startMs, bufferHours, excludeMeetingId } = opts;
  await assertProposedStartsOverlapHybrid({
    appUserId,
    startMsList: [startMs],
    bufferHours,
    excludeMeetingId,
  });
}

export type ConfirmedSlot = { meetingId: string; startMs: number };

export function collectUserConfirmedScheduleSlots(
  meetings: readonly MeetingScheduleOverlapDoc[],
  appUserId: string | null | undefined,
): ConfirmedSlot[] {
  const uid = appUserId?.trim() ?? '';
  if (!uid) return [];
  const out: ConfirmedSlot[] = [];
  for (const m of meetings) {
    if (m.scheduleConfirmed !== true) continue;
    if (!isUserJoinedMeetingForScheduleOverlap(m, uid)) continue;
    const t = meetingScheduleStartMs(m);
    if (t == null) continue;
    out.push({ meetingId: m.id, startMs: t });
  }
  return out;
}

export function meetingOverlapsUserConfirmedSlots(
  card: MeetingScheduleOverlapDoc,
  slots: readonly ConfirmedSlot[],
  bufferHours: number,
): boolean {
  const t = meetingScheduleStartMs(card);
  if (t == null) return false;
  const bufMs = bufferHours * 60 * 60 * 1000;
  for (const s of slots) {
    if (s.meetingId === card.id) continue;
    if (Math.abs(s.startMs - t) <= bufMs) return true;
  }
  return false;
}
