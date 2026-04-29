import { doc, getDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { sendFcmPushToUsersFireAndForget } from '@/src/lib/fcm-push-api';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import type { Meeting } from '@/src/lib/meetings';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { USER_EXPO_PUSH_TOKENS_COLLECTION } from '@/src/lib/user-expo-push-token';

export type MeetingHostPushAction =
  | 'confirmed'
  | 'unconfirmed'
  | 'deleted'
  | 'dates_updated'
  | 'places_updated'
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
    case 'auto_cancelled_unconfirmed':
      return {
        title: '모임이 자동 종료됐어요',
        body: `「${t}」모임이 확정되지 않아 자동 파기 됐습니다.`,
      };
    case 'dates_updated':
      return { title: '일정 후보가 변경됐어요', body: `「${t}」일정 후보가 바뀌었습니다. 눌러서 확인해 보세요.` };
    default:
      return { title: '장소 후보가 변경됐어요', body: `「${t}」장소 후보가 바뀌었습니다. 눌러서 확인해 보세요.` };
  }
}

function copyForHostParticipantEvent(
  action: 'joined' | 'left',
  meetingTitle: string,
  participantNickname: string,
): { title: string; body: string } {
  const t = meetingTitle.trim() || '모임';
  const who = participantNickname.trim() || '참여자';
  if (action === 'joined') {
    return { title: '참여자가 들어왔어요', body: `「${t}」에 ${who}님이 참여했습니다.` };
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
  if (recipients.length === 0) return;

  const { title, body } = copyForPush(action, meeting.title);
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action,
    url: `ginitapp://meeting/${meeting.id}`,
  };

  // Android(FCM) 서버 경유: 수신자 앱 종료 상태 수신 보강
  sendFcmPushToUsersFireAndForget({ toUserIds: recipients, title, body, data });
  // Android는 Expo Push도 FCM을 타므로 중복 방지: FCM만 사용
  if (Platform.OS === 'android') return;

  const tokens = await fetchExpoPushTokensForUsers(recipients);
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
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
  if (!nid) return;

  const { title, body } = copyForNewHostAssigned(meeting.title);
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action: 'host_transferred',
    url: `ginitapp://meeting/${meeting.id}`,
  };

  // Android(FCM) 서버 경유
  sendFcmPushToUsersFireAndForget({ toUserIds: [nid], title, body, data });
  // Android는 Expo Push도 FCM을 타므로 중복 방지: FCM만 사용
  if (Platform.OS === 'android') return;

  const tokens = await fetchExpoPushTokensForUsers([nid]);
  if (tokens.length === 0) return;
  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data,
  }));
  await sendExpoPushMessages(messages);
}

export function notifyMeetingNewHostAssignedFireAndForget(meeting: Meeting, newHostUserId: string): void {
  void notifyMeetingNewHostAssigned(meeting, newHostUserId).catch((err) => {
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
  event: 'joined' | 'left',
  participantNickname: string,
): Promise<void> {
  const host = normalizeParticipantId(hostUserId.trim());
  const participant = normalizeParticipantId(participantUserId.trim());
  if (!host || !participant) return;
  if (host === participant) return;

  const { title, body } = copyForHostParticipantEvent(event, meeting.title, participantNickname);
  const data: Record<string, unknown> = {
    meetingId: meeting.id,
    action: event === 'joined' ? 'participant_joined' : 'participant_left',
    participantId: participant,
    url: `ginitapp://meeting/${meeting.id}`,
  };

  // Android(FCM) 서버 경유
  sendFcmPushToUsersFireAndForget({ toUserIds: [host], title, body, data });
  // Android는 Expo Push도 FCM을 타므로 중복 방지: FCM만 사용
  if (Platform.OS === 'android') return;

  const tokens = await fetchExpoPushTokensForUsers([host]);
  if (tokens.length === 0) return;
  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data,
  }));
  await sendExpoPushMessages(messages);
}

export function notifyMeetingHostParticipantEventFireAndForget(
  meeting: Meeting,
  hostUserId: string,
  participantUserId: string,
  event: 'joined' | 'left',
  participantNickname: string,
): void {
  void notifyMeetingHostParticipantEvent(meeting, hostUserId, participantUserId, event, participantNickname).catch((err) => {
    if (__DEV__) {
      console.warn('[meeting-push]', err);
    }
  });
}
