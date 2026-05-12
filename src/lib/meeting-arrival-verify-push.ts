import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import type { Meeting } from '@/src/lib/meetings';
import { dispatchRemotePushToRecipients } from '@/src/lib/remote-push-hub';
import { getUserProfile } from '@/src/lib/user-profile';

const ARRIVAL_VERIFY_PUSH_ACTION = 'meeting_arrival_verified';

function meetingArrivalRecipientIds(meeting: Meeting, verifierAppUserId: string): string[] {
  const verifier = normalizeParticipantId(verifierAppUserId.trim());
  const out = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const id = normalizeParticipantId(raw);
    if (!id || id === verifier) return;
    out.add(id);
  };

  add(meeting.createdBy ?? '');
  for (const id of meeting.participantIds ?? []) {
    add(id);
  }
  return [...out];
}

async function resolveArrivalVerifierName(appUserId: string): Promise<string> {
  try {
    const profile = await getUserProfile(appUserId);
    const name = (profile?.nickname ?? profile?.displayName ?? '').trim();
    return name || '참여자';
  } catch {
    return '참여자';
  }
}

export async function notifyMeetingParticipantsOfArrivalVerified(
  meeting: Meeting,
  verifierAppUserId: string,
): Promise<void> {
  const verifier = normalizeParticipantId(verifierAppUserId.trim());
  if (!meeting.id.trim() || !verifier) return;

  const recipients = meetingArrivalRecipientIds(meeting, verifier);
  if (recipients.length === 0) {
    ginitNotifyDbg('meeting-arrival-push', 'skip_no_recipients', { meetingId: meeting.id });
    return;
  }

  const meetingTitle = meeting.title?.trim() || '모임';
  const verifierName = await resolveArrivalVerifierName(verifier);
  const title = '약속장소 도착 알림';
  const body = `「${meetingTitle}」의 ${verifierName}님이 약속장소에 도착했어요.`;

  ginitNotifyDbg('meeting-arrival-push', 'dispatch', {
    meetingId: meeting.id,
    recipientCount: recipients.length,
  });
  await dispatchRemotePushToRecipients({
    toUserIds: recipients,
    title,
    body,
    data: {
      meetingId: meeting.id,
      action: ARRIVAL_VERIFY_PUSH_ACTION,
      participantId: verifier,
      participantName: verifierName,
      url: `ginitapp://meeting/${meeting.id}`,
    },
  });
}

export function notifyMeetingParticipantsOfArrivalVerifiedFireAndForget(
  meeting: Meeting,
  verifierAppUserId: string,
): void {
  void notifyMeetingParticipantsOfArrivalVerified(meeting, verifierAppUserId).catch((err) => {
    ginitNotifyDbg('meeting-arrival-push', 'error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[meeting-arrival-push]', err);
    }
  });
}
