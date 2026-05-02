import type { Meeting } from '@/src/lib/meetings';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { dispatchRemotePushToRecipients } from '@/src/lib/remote-push-hub';

/** 동일 모임·동일 상대 짧은 간격 중복 발송 방지(연타·비동기 중복 호출 등). */
const HOST_PUSH_DEDUPE_MS = 4500;
const hostParticipantPushLastAt = new Map<string, number>();
const joinRequestApplicantPushLastAt = new Map<string, number>();

function dedupeSkipPush(map: Map<string, number>, key: string, now: number): boolean {
  const prev = map.get(key) ?? 0;
  if (now - prev < HOST_PUSH_DEDUPE_MS) return true;
  map.set(key, now);
  return false;
}

export type MeetingHostPushAction =
  | 'confirmed'
  | 'unconfirmed'
  | 'deleted'
  | 'dates_updated'
  | 'places_updated'
  | 'details_updated'
  | 'auto_cancelled_unconfirmed';

function hostNorm(hostUserId: string): string {
  return normalizeParticipantId(hostUserId.trim());
}

/** 주관자 제외 참가자 전화 PK 목록 */
function participantRecipientIds(m: Meeting, hostId: string): string[] {
  const h = hostNorm(hostId);
  const raw = m.participantIds ?? [];
  const out = new Set<string>();
  for (const x of raw) {
    const id = normalizeParticipantId(String(x));
    if (!id || id === h) continue;
    out.add(id);
  }
  return [...out];
}

function copyForPush(action: MeetingHostPushAction, meetingTitle: string): { title: string; body: string } {
  const t = meetingTitle.trim() || '모임';
  switch (action) {
    case 'confirmed':
      return { title: '일정이 확정됐어요', body: `「${t}」일정·장소가 확정됐습니다. 눌러서 확인해 보세요.` };
    case 'unconfirmed':
      return { title: '일정 확정이 취소됐어요', body: `「${t}」확정이 취소됐습니다. 눌러서 확인해 보세요.` };
    case 'deleted':
      return { title: '모임이 삭제됐어요', body: `「${t}」모임이 주관자에 의해 삭제됐습니다.` };
    case 'auto_cancelled_unconfirmed':
      return {
        title: '모임이 자동 종료됐어요',
        body: `「${t}」모임이 확정되지 않아 자동 파기 됐습니다.`,
      };
    case 'dates_updated':
      return { title: '일정 후보가 변경됐어요', body: `「${t}」일정 후보가 바뀌었습니다. 눌러서 확인해 보세요.` };
    case 'details_updated':
      return {
        title: '모임 정보가 바뀌었어요',
        body: `「${t}」이름·소개·인원 등이 업데이트됐습니다. 눌러서 확인해 보세요.`,
      };
    default:
      return { title: '장소 후보가 변경됐어요', body: `「${t}」장소 후보가 바뀌었습니다. 눌러서 확인해 보세요.` };
  }
}

function copyForHostParticipantEvent(
  action: 'joined' | 'left' | 'join_requested',
  meetingTitle: string,
  participantNickname: string,
): { title: string; body: string } {
  const t = meetingTitle.trim() || '모임';
  const who = participantNickname.trim() || '참여자';
  if (action === 'joined') {
    return { title: '참여자가 들어왔어요', body: `「${t}」에 ${who}님이 참여했습니다.` };
  }
  if (action === 'join_requested') {
    return { title: '참가 신청이 왔어요', body: `「${t}」에 ${who}님이 참가를 신청했습니다. 눌러서 확인해 주세요.` };
  }
  return { title: '참여자가 나갔어요', body: `「${t}」에서 ${who}님이 나갔습니다.` };
}

/**
 * 주관자 액션 후 참가자(주관자 제외)에게 푸시. 실패는 삼키고 로그만(호출부 UX 유지).
 */
export async function notifyMeetingParticipantsOfHostAction(
  meeting: Meeting,
  action: MeetingHostPushAction,
  hostPhoneUserId: string,
): Promise<void> {
  const recipients = participantRecipientIds(meeting, hostPhoneUserId);
  if (recipients.length === 0) {
    ginitNotifyDbg('meeting-host-push', 'host_action_skip_no_recipients', { meetingId: meeting.id, action });
    return;
  }

  ginitNotifyDbg('meeting-host-push', 'host_action_dispatch', {
    meetingId: meeting.id,
    action,
    recipientCount: recipients.length,
  });
  const { title, body } = copyForPush(action, meeting.title);
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action,
    url: `ginitapp://meeting/${meeting.id}`,
  };

  await dispatchRemotePushToRecipients({ toUserIds: recipients, title, body, data });
}

export function notifyMeetingParticipantsOfHostActionFireAndForget(
  meeting: Meeting,
  action: MeetingHostPushAction,
  hostPhoneUserId: string,
): void {
  void notifyMeetingParticipantsOfHostAction(meeting, action, hostPhoneUserId).catch((err) => {
    ginitNotifyDbg('meeting-host-push', 'host_action_error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}

function copyForNewHostAssigned(meetingTitle: string): { title: string; body: string } {
  const t = meetingTitle.trim() || '모임';
  return {
    title: '방장 권한이 이관됐어요',
    body: `「${t}」모임의 방장 권한이 회원님에게 이관됐습니다. 눌러서 확인해 보세요.`,
  };
}

/**
 * 방장 이관: 새 방장 1명에게만 푸시 알림을 보냅니다.
 * 실패는 삼키고 로그만(탈퇴 UX 유지).
 */
export async function notifyMeetingNewHostAssigned(
  meeting: Meeting,
  newHostUserId: string,
): Promise<void> {
  const nid = normalizeParticipantId(newHostUserId.trim());
  if (!nid) {
    ginitNotifyDbg('meeting-host-push', 'new_host_skip_bad_id', { meetingId: meeting.id });
    return;
  }

  ginitNotifyDbg('meeting-host-push', 'new_host_dispatch', { meetingId: meeting.id });
  const { title, body } = copyForNewHostAssigned(meeting.title);
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action: 'host_transferred',
    url: `ginitapp://meeting/${meeting.id}`,
  };

  await dispatchRemotePushToRecipients({ toUserIds: [nid], title, body, data });
}

export function notifyMeetingNewHostAssignedFireAndForget(meeting: Meeting, newHostUserId: string): void {
  void notifyMeetingNewHostAssigned(meeting, newHostUserId).catch((err) => {
    ginitNotifyDbg('meeting-host-push', 'new_host_error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}

/**
 * 호스트에게: 참여자 입장/퇴장 알림(호스트 1명에게만).
 */
export async function notifyMeetingHostParticipantEvent(
  meeting: Meeting,
  hostUserId: string,
  participantUserId: string,
  event: 'joined' | 'left' | 'join_requested',
  participantNickname: string,
): Promise<void> {
  const host = normalizeParticipantId(hostUserId.trim());
  const participant = normalizeParticipantId(participantUserId.trim());
  if (!host || !participant) {
    ginitNotifyDbg('meeting-host-push', 'participant_event_skip_bad_ids', { meetingId: meeting.id, event });
    return;
  }
  if (host === participant) return;

  const dedupeKey = `${meeting.id}\u001f${participant}\u001f${event}`;
  const now = Date.now();
  if (dedupeSkipPush(hostParticipantPushLastAt, dedupeKey, now)) {
    ginitNotifyDbg('meeting-host-push', 'participant_event_dedupe_skip', { meetingId: meeting.id, event });
    return;
  }

  ginitNotifyDbg('meeting-host-push', 'participant_event_dispatch', { meetingId: meeting.id, event });
  const { title, body } = copyForHostParticipantEvent(event, meeting.title, participantNickname);
  const actionData =
    event === 'joined' ? 'participant_joined' : event === 'left' ? 'participant_left' : 'participant_join_requested';
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action: actionData,
    participantId: participant,
    url: `ginitapp://meeting/${meeting.id}`,
  };

  await dispatchRemotePushToRecipients({ toUserIds: [host], title, body, data });
}

export function notifyMeetingHostParticipantEventFireAndForget(
  meeting: Meeting,
  hostUserId: string,
  participantUserId: string,
  event: 'joined' | 'left' | 'join_requested',
  participantNickname: string,
): void {
  void notifyMeetingHostParticipantEvent(meeting, hostUserId, participantUserId, event, participantNickname).catch((err) => {
    ginitNotifyDbg('meeting-host-push', 'participant_event_error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}

function copyForJoinRequestApplicantDecision(
  decision: 'approved' | 'rejected',
  meetingTitle: string,
): { title: string; body: string } {
  const t = meetingTitle.trim() || '모임';
  if (decision === 'approved') {
    return {
      title: '참가가 승인됐어요',
      body: `「${t}」모임 참가가 승인됐습니다. 눌러서 확인해 보세요.`,
    };
  }
  return {
    title: '참가 신청이 거절됐어요',
    body: `「${t}」모임 참가 신청이 거절됐습니다.`,
  };
}

/**
 * 참가 신청자에게: 호스트가 승인했거나 거절했을 때 원격 푸시(실패는 삼키고 로그만).
 */
export async function notifyMeetingJoinRequestApplicantDecision(
  meeting: Meeting,
  applicantUserId: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const aid = normalizeParticipantId(applicantUserId.trim());
  if (!aid) {
    ginitNotifyDbg('meeting-host-push', 'join_req_applicant_skip_bad_id', { meetingId: meeting.id, decision });
    return;
  }

  const dedupeKey = `${meeting.id}\u001f${aid}\u001f${decision}`;
  const now = Date.now();
  if (dedupeSkipPush(joinRequestApplicantPushLastAt, dedupeKey, now)) {
    ginitNotifyDbg('meeting-host-push', 'join_req_applicant_dedupe_skip', { meetingId: meeting.id, decision });
    return;
  }

  ginitNotifyDbg('meeting-host-push', 'join_req_applicant_dispatch', { meetingId: meeting.id, decision });
  const { title, body } = copyForJoinRequestApplicantDecision(decision, meeting.title);
  const action = decision === 'approved' ? 'join_request_approved' : 'join_request_rejected';
  await dispatchRemotePushToRecipients({
    toUserIds: [aid],
    title,
    body,
    data: {
      meetingId: meeting.id,
      action,
      url: `ginitapp://meeting/${meeting.id}`,
    },
  });
}

export function notifyMeetingJoinRequestApplicantDecisionFireAndForget(
  meeting: Meeting,
  applicantUserId: string,
  decision: 'approved' | 'rejected',
): void {
  void notifyMeetingJoinRequestApplicantDecision(meeting, applicantUserId, decision).catch((err) => {
    ginitNotifyDbg('meeting-host-push', 'join_req_applicant_error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}

/** 원격 푸시 `data.action` — `push-open-navigation` 등과 동기 */
export const MEETING_REMOVED_BY_HOST_PUSH_ACTION = 'meeting_removed_by_host';

function copyForParticipantRemovedByHost(meetingTitle: string): { title: string; body: string } {
  const t = meetingTitle.trim() || '모임';
  return {
    title: '모임에서 퇴장됐어요',
    body: `호스트에 의해 「${t}」모임에서 퇴장 처리됐습니다. 이 모임에는 다시 참여할 수 없어요.`,
  };
}

/**
 * 호스트 강제 퇴장: 퇴장당한 참가자 1명에게만 푸시(실패는 삼키고 로그만).
 */
export async function notifyMeetingParticipantRemovedByHost(
  meeting: Meeting,
  removedUserId: string,
): Promise<void> {
  const rid = normalizeParticipantId(removedUserId.trim());
  if (!rid) {
    ginitNotifyDbg('meeting-host-push', 'removed_by_host_skip_bad_id', { meetingId: meeting.id });
    return;
  }

  ginitNotifyDbg('meeting-host-push', 'removed_by_host_dispatch', { meetingId: meeting.id });
  const { title, body } = copyForParticipantRemovedByHost(meeting.title);
  await dispatchRemotePushToRecipients({
    toUserIds: [rid],
    title,
    body,
    data: {
      meetingId: meeting.id,
      action: MEETING_REMOVED_BY_HOST_PUSH_ACTION,
      url: `ginitapp://meeting/${meeting.id}`,
    },
  });
}

export function notifyMeetingParticipantRemovedByHostFireAndForget(
  meeting: Meeting,
  removedUserId: string,
): void {
  void notifyMeetingParticipantRemovedByHost(meeting, removedUserId).catch((err) => {
    ginitNotifyDbg('meeting-host-push', 'removed_by_host_error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}
