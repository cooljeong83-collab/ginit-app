import { doc, getDoc } from 'firebase/firestore';

import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import type { Meeting } from '@/src/lib/meetings';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { USER_EXPO_PUSH_TOKENS_COLLECTION } from '@/src/lib/user-expo-push-token';

export type MeetingHostPushAction =
  | 'confirmed'
  | 'unconfirmed'
  | 'deleted'
  | 'dates_updated'
  | 'places_updated';

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

async function fetchExpoPushTokensForUsers(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const db = getFirebaseFirestore();
  const tokens: string[] = [];
  await Promise.all(
    userIds.map(async (pid) => {
      const snap = await getDoc(doc(db, USER_EXPO_PUSH_TOKENS_COLLECTION, pid));
      const t = snap.data()?.token;
      if (typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))) {
        tokens.push(t);
      }
    }),
  );
  return tokens;
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
    case 'dates_updated':
      return { title: '일정 후보가 변경됐어요', body: `「${t}」일정 후보가 바뀌었습니다. 눌러서 확인해 보세요.` };
    default:
      return { title: '장소 후보가 변경됐어요', body: `「${t}」장소 후보가 바뀌었습니다. 눌러서 확인해 보세요.` };
  }
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
  if (recipients.length === 0) return;
  const tokens = await fetchExpoPushTokensForUsers(recipients);
  if (tokens.length === 0) return;

  const { title, body } = copyForPush(action, meeting.title);
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action,
    url: `ginitapp://meeting/${meeting.id}`,
  };

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    channelId: 'default',
    data,
  }));

  await sendExpoPushMessages(messages);
}

export function notifyMeetingParticipantsOfHostActionFireAndForget(
  meeting: Meeting,
  action: MeetingHostPushAction,
  hostPhoneUserId: string,
): void {
  void notifyMeetingParticipantsOfHostAction(meeting, action, hostPhoneUserId).catch((err) => {
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}
