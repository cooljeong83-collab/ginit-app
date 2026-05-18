import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getPolicyNumeric } from '@/src/lib/app-policies-store';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { meetingScheduleStartMs } from '@/src/lib/meeting-schedule-times';
import { meetingParticipantCount, type Meeting } from '@/src/lib/meetings';

function isMeetingSettlementTimeWindowOpen(meeting: Meeting, nowMs: number): boolean {
  if (meetingParticipantCount(meeting) < 2) return false;
  if (meeting.scheduleConfirmed !== true) return false;
  if (meeting.lifecycleStatus === 'SETTLED') return false;
  const startMs = meetingScheduleStartMs(meeting);
  if (startMs == null) return false;
  const hours = getPolicyNumeric('settlement', 'show_settle_cta_after_start_hours', 1);
  const h = Number.isFinite(hours) ? Math.max(0, Math.min(168, Math.trunc(hours))) : 1;
  return nowMs >= startMs + h * 3_600_000;
}

/**
 * 호스트 전용 정산 CTA(배너·정산 화면 진입) 노출 여부.
 * - 일정 확정 + 아직 SETTLED 아님 + 시작 시각 파싱 가능 + 정책 시간 경과
 * - 참가자가 호스트 본인만인 모임(실질 1명)은 제외
 */
export function isMeetingSettlementCtaEligibleForHost(
  meeting: Meeting,
  hostAppUserId: string,
  nowMs: number,
): boolean {
  const host = (hostAppUserId ?? '').trim();
  if (!host) return false;
  const created = (meeting.createdBy ?? '').trim();
  if (!created) return false;
  const nh = normalizeParticipantId(host) ?? host;
  const nc = normalizeParticipantId(created) ?? created;
  if (nh !== nc) return false;
  return isMeetingSettlementTimeWindowOpen(meeting, nowMs);
}

/** 참여자(호스트 포함) 함께 정산하기 CTA — 시간·인원 조건은 호스트와 동일, 참여 중이어야 함 */
export function isMeetingSettlementCollaborationEligible(
  meeting: Meeting,
  appUserId: string,
  nowMs: number,
): boolean {
  const uid = (appUserId ?? '').trim();
  if (!uid) return false;
  if (!isUserJoinedMeeting(meeting, uid)) return false;
  return isMeetingSettlementTimeWindowOpen(meeting, nowMs);
}

/** 홈 등에서 호스트 여부만 빠르게 확인할 때 */
export function isMeetingHost(meeting: Pick<Meeting, 'createdBy'>, appUserId: string): boolean {
  const uid = (appUserId ?? '').trim();
  if (!uid) return false;
  const cb = (meeting.createdBy ?? '').trim();
  if (!cb) return false;
  return (normalizeParticipantId(uid) ?? uid) === (normalizeParticipantId(cb) ?? cb);
}
