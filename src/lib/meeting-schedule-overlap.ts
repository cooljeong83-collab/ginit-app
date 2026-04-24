import { publicEnv } from '@/src/config/public-env';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import { meetingScheduleStartMs, type MeetingScheduleTimeFields } from '@/src/lib/meeting-schedule-times';
import { supabase } from '@/src/lib/supabase';
import type { UserProfile } from '@/src/lib/user-profile';

/** 일정 겹침에 쓰는 최소 필드(`meetings.Meeting`과 구조 호환, meetings.ts 미참조). */
export type MeetingScheduleOverlapDoc = MeetingScheduleTimeFields & {
  id: string;
  createdBy?: string | null;
  participantIds?: string[] | null;
  scheduleConfirmed?: boolean | null;
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

export const OVERLAP_CONFLICT_MESSAGE_3H = '이미 해당 시간대 근처(3시간 이내)에 다른 확정된 약속이 있습니다.';
export const OVERLAP_CONFLICT_MESSAGE_2H = '이미 해당 시간대 근처(2시간 이내)에 다른 확정된 약속이 있습니다.';

export const GINIT_AGENT_SCHEDULE_OVERLAP_SUGGESTION =
  '지닛이 확인해보니 이때는 이동 시간이 부족할 것 같아요! 다른 시간대의 모임을 찾아볼까요?';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getScheduleOverlapBufferHours(profile: UserProfile | null | undefined): 2 | 3 {
  const lv =
    typeof profile?.gLevel === 'number' && Number.isFinite(profile.gLevel) ? Math.floor(profile.gLevel) : 1;
  const trust =
    typeof profile?.gTrust === 'number' && Number.isFinite(profile.gTrust) ? Math.floor(profile.gTrust) : 0;
  if (lv >= OVERLAP_RELAX_G_LEVEL_MIN && trust >= OVERLAP_RELAX_G_TRUST_MIN) return 2;
  return 3;
}

export function isUuidMeetingIdForOverlap(id: string): boolean {
  return UUID_V4_RE.test(id.trim());
}

export function isConfirmedScheduleOverlapErrorMessage(message: string): boolean {
  return message.includes('확정된 약속이 있습니다');
}

function overlapThrowMessage(bufferHours: 2 | 3): string {
  return bufferHours === 2 ? OVERLAP_CONFLICT_MESSAGE_2H : OVERLAP_CONFLICT_MESSAGE_3H;
}

function normalizeRpcOverlapError(raw: string, bufferHours: 2 | 3): string {
  if (raw.includes('2시간 이내')) return OVERLAP_CONFLICT_MESSAGE_2H;
  if (raw.includes('3시간 이내')) return OVERLAP_CONFLICT_MESSAGE_3H;
  return overlapThrowMessage(bufferHours);
}

/**
 * Firestore 전체 모임 스캔 — 레저(SQL)에만 있는 모임은 `skipLedgerIds`로 제외(RPC가 담당).
 */
export function findFirestoreConfirmedOverlap(
  meetings: readonly MeetingScheduleOverlapDoc[],
  appUserId: string,
  proposedStartMs: number,
  bufferHours: 2 | 3,
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
 * Postgres(RPC) + Firestore 목록 보강. `meetings.ts`와의 순환 참조를 피하기 위해 동적 import 사용.
 */
export async function assertNoConfirmedScheduleOverlapHybrid(opts: {
  appUserId: string;
  startMs: number;
  bufferHours: 2 | 3;
  excludeMeetingId?: string | null;
}): Promise<void> {
  const { appUserId, startMs, bufferHours, excludeMeetingId } = opts;
  const uid = appUserId.trim();
  if (!uid || !Number.isFinite(startMs)) return;

  const iso = new Date(startMs).toISOString();
  const excludeUuid =
    excludeMeetingId?.trim() && isUuidMeetingIdForOverlap(excludeMeetingId) ? excludeMeetingId.trim() : null;

  if (publicEnv.supabaseUrl?.trim() && publicEnv.supabaseAnonKey?.trim()) {
    const { error } = await supabase.rpc('assert_no_confirmed_schedule_overlap', {
      p_app_user_id: uid,
      p_start: iso,
      p_buffer_hours: bufferHours,
      p_exclude_meeting_id: excludeUuid,
    });
    if (error) {
      throw new Error(normalizeRpcOverlapError(error.message, bufferHours));
    }
  }

  const { fetchMeetingsOnce } = await import('@/src/lib/meetings');
  const fr = await fetchMeetingsOnce();
  if (!fr.ok) return;
  if (
    findFirestoreConfirmedOverlap(fr.meetings, uid, startMs, bufferHours, excludeMeetingId, ledgerWritesToSupabase())
  ) {
    throw new Error(overlapThrowMessage(bufferHours));
  }
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
  bufferHours: 2 | 3,
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
