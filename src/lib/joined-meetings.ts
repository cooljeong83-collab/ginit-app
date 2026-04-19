import { getMeetingRecruitmentPhase, type Meeting } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

function participantPk(raw: string): string {
  return normalizePhoneUserId(raw) ?? raw.trim();
}

/** 주최자이거나 `participantIds`에 포함된 경우 */
export function isUserJoinedMeeting(m: Meeting, phoneUserId: string | null | undefined): boolean {
  if (!phoneUserId?.trim()) return false;
  const u = participantPk(phoneUserId);
  const hostRaw = m.createdBy?.trim() ?? '';
  if (hostRaw) {
    const host = participantPk(hostRaw);
    if (host === u) return true;
  }
  for (const id of m.participantIds ?? []) {
    if (participantPk(String(id)) === u) return true;
  }
  return false;
}

/** 일정 미확정 등 조율 단계로 보는 모임 */
export function isCoordinatingMeeting(m: Meeting): boolean {
  return m.scheduleConfirmed !== true;
}

export function filterJoinedMeetings(meetings: Meeting[], phoneUserId: string | null | undefined): Meeting[] {
  return meetings.filter((m) => isUserJoinedMeeting(m, phoneUserId));
}

export function filterJoinedCoordinatingMeetings(
  meetings: Meeting[],
  phoneUserId: string | null | undefined,
): Meeting[] {
  return meetings.filter((m) => isUserJoinedMeeting(m, phoneUserId) && isCoordinatingMeeting(m));
}

/** 스냅샷 옆 말풍선·미니 카드용 짧은 상태 문구 */
export function joinedMeetingAgentLine(m: Meeting, salt: number): string {
  const phase = getMeetingRecruitmentPhase(m);
  if (phase === 'confirmed') return '일정이 확정됐어요!';
  const lines = [
    '지닛이 장소를 찾고 있어요!',
    '지닛이 일정을 조율 중이에요!',
    '지닛이 투표를 모으고 있어요!',
  ];
  return lines[Math.abs(salt) % lines.length];
}
