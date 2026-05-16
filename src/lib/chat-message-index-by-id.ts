import type { MeetingChatMessage } from '@/src/lib/meeting-chat';

/** 말풍선 읽음 비교용: 서버 id·`local:{cmid}`·cmid 모두 동일 인덱스로 매핑 */
export function buildChatMessageIndexById(messages: readonly MeetingChatMessage[]): Map<string, number> {
  const m = new Map<string, number>();
  messages.forEach((msg, i) => {
    const id = msg.id?.trim();
    if (id) m.set(id, i);
    const cmid = msg.clientMutationId?.trim();
    if (cmid) {
      m.set(cmid, i);
      m.set(`local:${cmid}`, i);
    }
  });
  return m;
}
