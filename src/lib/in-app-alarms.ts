import type { Timestamp } from 'firebase/firestore';

import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export type InAppAlarmKind = 'chat' | 'meeting_change';

export type InAppAlarmRow = {
  kind: InAppAlarmKind;
  meetingId: string;
  meetingTitle: string;
  subtitle: string;
  sortMs: number;
  /** 채팅 알림일 때 읽음 처리에 사용 */
  latestMessageId?: string;
};

export type InAppAlarmReadState = {
  /** 마지막으로 읽은 처리한 메시지 id (없으면 미기록) */
  chatReadMessageId: Record<string, string>;
  /** 마지막으로 확인한 모임 문서 지문 */
  meetingAckFingerprint: Record<string, string>;
};

export function defaultInAppAlarmReadState(): InAppAlarmReadState {
  return { chatReadMessageId: {}, meetingAckFingerprint: {} };
}

export function chatMessageTimeMs(m: MeetingChatMessage | null | undefined): number {
  const ts = m?.createdAt as Timestamp | null | undefined;
  if (!ts || typeof ts.toMillis !== 'function') return 0;
  try {
    return ts.toMillis();
  } catch {
    return 0;
  }
}

function stableSortedParticipantLine(ids: string[] | null | undefined): string {
  if (!ids?.length) return '';
  return [...ids]
    .map((x) => normalizePhoneUserId(String(x)) ?? String(x).trim())
    .filter(Boolean)
    .sort()
    .join('|');
}

/** 참여 모임의 일정·장소·참여·투표 등 변동을 감지하기 위한 안정 지문 */
export function meetingChangeFingerprint(m: Meeting): string {
  const parts = [
    m.title?.trim() ?? '',
    String(meetingParticipantCount(m)),
    stableSortedParticipantLine(m.participantIds),
    m.scheduleConfirmed === true ? '1' : '0',
    m.confirmedDateChipId ?? '',
    m.confirmedPlaceChipId ?? '',
    m.confirmedMovieChipId ?? '',
    m.scheduleDate ?? '',
    m.scheduleTime ?? '',
    m.placeName ?? '',
    m.address ?? '',
    m.location ?? '',
    JSON.stringify(m.dateCandidates ?? null),
    JSON.stringify(m.placeCandidates ?? null),
    JSON.stringify(m.voteTallies ?? null),
    JSON.stringify(m.participantVoteLog ?? null),
  ];
  return parts.join('\u001f');
}
