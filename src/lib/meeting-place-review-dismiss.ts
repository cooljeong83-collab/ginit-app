import { DeviceEventEmitter } from 'react-native';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { fetchMeetingPlaceReviewSummary } from '@/src/lib/meeting-review/meeting-review-api';
import {
  fetchUnreadMeetingPlaceReviewNotifications,
  markMeetingPlaceReviewNotificationRead,
  parseMeetingPlaceReviewPayload,
} from '@/src/lib/meeting-place-review-notifications';

export const GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT = 'ginit_meeting_place_review_submitted';

export type GinitMeetingPlaceReviewSubmittedPayload = {
  meetingId: string;
};

export function emitMeetingPlaceReviewSubmitted(meetingId: string): void {
  const id = meetingId.trim();
  if (!id) return;
  DeviceEventEmitter.emit(GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT, {
    meetingId: id,
  } satisfies GinitMeetingPlaceReviewSubmittedPayload);
}

/** 써머리 RPC 기준 — 본인 후기 제출 여부 */
export async function hasUserSubmittedMeetingPlaceReview(
  meetingId: string,
  appUserId: string,
): Promise<boolean> {
  const mid = meetingId.trim();
  const uid = appUserId.trim();
  if (!mid || !uid) return false;
  const res = await fetchMeetingPlaceReviewSummary(mid, uid);
  if (!res.ok) return false;
  if (res.summary.myReview) return true;
  const pk = normalizeParticipantId(uid) ?? uid;
  return res.summary.participants.some(
    (p) => (normalizeParticipantId(p.appUserId) ?? p.appUserId) === pk && p.hasReviewed,
  );
}

/** 정산 후기 안내 알림·공지 배너 제거 — 해당 모임 unread 알림을 읽음 처리 */
export async function dismissMeetingPlaceReviewNoticesForMeeting(
  meetingId: string,
  appUserId: string,
): Promise<void> {
  const mid = meetingId.trim();
  const uid = normalizeParticipantId(appUserId.trim()) || appUserId.trim();
  if (!mid || !uid) return;
  const items = await fetchUnreadMeetingPlaceReviewNotifications(uid);
  const targets = items.filter((doc) => parseMeetingPlaceReviewPayload(doc.payload)?.meetingId === mid);
  await Promise.all(targets.map((doc) => markMeetingPlaceReviewNotificationRead(doc.id, uid).catch(() => {})));
}

export async function onMeetingPlaceReviewSubmitted(meetingId: string, appUserId: string): Promise<void> {
  emitMeetingPlaceReviewSubmitted(meetingId);
  await dismissMeetingPlaceReviewNoticesForMeeting(meetingId, appUserId);
}
