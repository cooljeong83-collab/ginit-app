import type { Meeting } from '@/src/lib/meetings';
import { meetingScheduleStartMs } from '@/src/lib/meeting-schedule-times';
import type { MeetingArrivalVerifyPolicy } from '@/src/lib/meeting-arrival-verify';

/**
 * 상단 장소 인증 공지 노출 시간대.
 * `notice_before_min`이 30이면 예정 30분 전부터, 0이면 시작 시각부터 노출합니다.
 */
export function isMeetingArrivalNoticeBannerTimeEligible(
  meeting: Pick<Meeting, 'scheduleConfirmed' | 'scheduledAt' | 'scheduleDate' | 'scheduleTime'>,
  nowMs: number,
  pol: MeetingArrivalVerifyPolicy,
): boolean {
  if (meeting.scheduleConfirmed !== true) return false;
  const scheduledMs = meetingScheduleStartMs(meeting);
  if (scheduledMs == null) return false;
  const windowEndMs = scheduledMs + pol.window_after_min * 60_000;
  const eligibleFromMs = scheduledMs - pol.notice_before_min * 60_000;
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
  return isMeetingArrivalNoticeBannerTimeEligible(i.meeting, i.nowMs, i.pol);
}
