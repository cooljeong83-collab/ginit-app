import type { Meeting } from '@/src/lib/meetings';
import { meetingScheduleStartMs } from '@/src/lib/meeting-schedule-times';
import type { MeetingArrivalVerifyPolicy } from '@/src/lib/meeting-arrival-verify';

/**
 * 로컬 장소 인증 리마인더 알림과 동일한 시간대(예정 시작+지연 ~ 인증 마감).
 * @see syncMeetingArrivalReminderLocalNotifications
 */
export function isMeetingArrivalReminderBannerTimeEligible(
  meeting: Pick<Meeting, 'scheduleConfirmed' | 'scheduledAt' | 'scheduleDate' | 'scheduleTime'>,
  nowMs: number,
  pol: MeetingArrivalVerifyPolicy,
): boolean {
  if (meeting.scheduleConfirmed !== true) return false;
  const scheduledMs = meetingScheduleStartMs(meeting);
  if (scheduledMs == null) return false;
  const windowEndMs = scheduledMs + pol.window_after_min * 60_000;
  const eligibleFromMs = scheduledMs + pol.reminder_after_scheduled_min * 60_000;
  return nowMs >= eligibleFromMs && nowMs <= windowEndMs;
}

export type MeetingArrivalVerifyTopBannerInput = {
  platformOs: typeof import('react-native').Platform.OS;
  meeting: Meeting | null | undefined;
  userId: string | null | undefined;
  verifiedByMe: boolean;
  nowMs: number;
  pol: MeetingArrivalVerifyPolicy;
  /** `isConfirmedMeetingPastListEndWindow` 등 상세·채팅과 동일 */
  isMeetingEndedForArrivalUi: boolean;
  /** 상세: `alreadyJoinedMeeting || isHost` / 채팅: `isUserJoinedMeeting` */
  canAccessArrivalFlow: boolean;
  ledgerArrivalSupported: boolean;
};

/** 모임 상세·채팅 상단 장소 인증 CTA 배너 노출 */
export function shouldShowMeetingArrivalVerifyTopBanner(i: MeetingArrivalVerifyTopBannerInput): boolean {
  if (i.platformOs === 'web') return false;
  if (!i.meeting || i.meeting.scheduleConfirmed !== true) return false;
  if (i.isMeetingEndedForArrivalUi) return false;
  if (!i.ledgerArrivalSupported) return false;
  if (!i.canAccessArrivalFlow) return false;
  if (!i.userId?.trim()) return false;
  if (i.verifiedByMe) return false;
  return isMeetingArrivalReminderBannerTimeEligible(i.meeting, i.nowMs, i.pol);
}
