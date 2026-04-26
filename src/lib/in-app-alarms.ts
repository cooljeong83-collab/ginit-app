import type { Timestamp } from 'firebase/firestore';

import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export type InAppAlarmKind = 'chat' | 'meeting_change' | 'friend_request';

export type InAppAlarmRow = {
  /** FlatList 키(누적 알람 지원) */
  id: string;
  kind: InAppAlarmKind;
  meetingId: string;
  meetingTitle: string;
  subtitle: string;
  sortMs: number;
  /** 채팅 알림일 때 읽음 처리에 사용 */
  latestMessageId?: string;
  /** kind === 'friend_request' — 요청자 앱 사용자 id */
  requesterAppUserId?: string;
};

export type InAppAlarmReadState = {
  /** 마지막으로 읽은 처리한 메시지 id (없으면 미기록) */
  chatReadMessageId: Record<string, string>;
  /** 마지막으로 확인한 모임 문서 지문 */
  meetingAckFingerprint: Record<string, string>;
  /** 수락/거절 전에 알람 패널에서 확인한 친구 요청(friendships.id) */
  friendRequestDismissedIds: Record<string, true>;
};

export function defaultInAppAlarmReadState(): InAppAlarmReadState {
  return { chatReadMessageId: {}, meetingAckFingerprint: {}, friendRequestDismissedIds: {} };
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

/**
 * Firestore에서 내려온 객체 키 순서가 달라져도 동일한 값이면 같은 문자열이 되도록 직렬화합니다.
 * (앱 재시작마다 `JSON.stringify` 순서만 바뀌어 미확인 모임 알람이 다시 뜨는 현상 방지)
 */
export function stableJsonForFingerprint(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonForFingerprint(item)).join(',')}]`;
  }
  if (t !== 'object') return JSON.stringify(String(value));
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJsonForFingerprint(obj[k])}`).join(',')}}`;
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
    stableJsonForFingerprint(m.dateCandidates ?? null),
    stableJsonForFingerprint(m.placeCandidates ?? null),
    stableJsonForFingerprint(m.voteTallies ?? null),
    stableJsonForFingerprint(m.participantVoteLog ?? null),
  ];
  return parts.join('\u001f');
}
