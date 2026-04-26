import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';

/** 모임 문서의 `chatReadMessageIdBy`에서 내 마지막 읽은 메시지 id (키 형식이 달라도 정규화로 매칭) */
export function readMessageIdFromMeetingDoc(m: Meeting, userPk: string, rawUid: string): string {
  const by = m.chatReadMessageIdBy;
  if (!by || typeof by !== 'object') return '';
  const tryKey = (k: string) => (k ? String((by as Record<string, string>)[k] ?? '').trim() : '');
  let s = userPk ? tryKey(userPk) : '';
  if (s) return s;
  const raw = rawUid.trim();
  if (raw) {
    s = tryKey(raw);
    if (s) return s;
  }
  if (userPk) {
    for (const [k, v] of Object.entries(by)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if ((normalizeParticipantId(k) ?? k.trim()) === userPk) return v.trim();
    }
  }
  return '';
}

/** 로컬 읽음 맵 + 서버 문서 + 최신 메시지 id를 합쳐 읽음 커서 문자열 */
export function effectiveMeetingChatReadId(
  m: Meeting,
  userPk: string,
  rawUid: string,
  localMap: Record<string, string>,
  latestMessageId?: string | null,
): string {
  const fromDoc = readMessageIdFromMeetingDoc(m, userPk, rawUid);
  const latest = (latestMessageId ?? '').trim();
  if (latest && fromDoc === latest) return fromDoc;
  const local = (localMap[m.id] ?? '').trim();
  if (local) return local;
  return fromDoc;
}
