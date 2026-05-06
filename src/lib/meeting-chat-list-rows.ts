import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';

export type MeetingChatListRow =
  | { type: 'message'; message: MeetingChatMessage }
  | { type: 'imageAlbum'; batchId: string; messages: MeetingChatMessage[] };

/** 앨범 행에서 날짜·시간·읽음 앵커로 쓸 메시지(보낸 순서상 가장 최신). */
export function meetingChatAlbumAnchorMessage(row: { type: 'imageAlbum'; messages: MeetingChatMessage[] }): MeetingChatMessage {
  const arr = row.messages;
  return arr[arr.length - 1]!;
}

export function meetingChatListRowKey(row: MeetingChatListRow): string {
  if (row.type === 'message') return row.message.id;
  return `album:${row.batchId}:${row.messages.map((m) => m.id).join(':')}`;
}

export function findMeetingChatListRowIndexByMessageId(rows: MeetingChatListRow[], messageId: string): number {
  const mid = String(messageId ?? '').trim();
  if (!mid) return -1;
  return rows.findIndex((row) => {
    if (row.type === 'message') return row.message.id === mid;
    return row.messages.some((m) => m.id === mid);
  });
}

/**
 * `messages`는 최신이 index 0인 배열(모임·DM 공통).
 * 같은 `imageAlbumBatchId`를 가진 연속 이미지(시간순)를 카카오톡식 앨범 한 줄로 합칩니다.
 */
export function buildMeetingChatListRows(messages: MeetingChatMessage[]): MeetingChatListRow[] {
  if (messages.length === 0) return [];
  const chrono = [...messages].reverse();
  const groupedChrono: MeetingChatListRow[] = [];
  let i = 0;
  while (i < chrono.length) {
    const m = chrono[i]!;
    const bid = typeof m.imageAlbumBatchId === 'string' ? m.imageAlbumBatchId.trim() : '';
    if (m.kind === 'image' && bid) {
      const sid = normalizeParticipantId(String(m.senderId ?? '').trim());
      const batch: MeetingChatMessage[] = [m];
      let j = i + 1;
      while (j < chrono.length) {
        const n = chrono[j]!;
        const nb = typeof n.imageAlbumBatchId === 'string' ? n.imageAlbumBatchId.trim() : '';
        if (
          n.kind === 'image' &&
          nb === bid &&
          normalizeParticipantId(String(n.senderId ?? '').trim()) === sid
        ) {
          batch.push(n);
          j++;
        } else break;
      }
      if (batch.length > 1) {
        groupedChrono.push({ type: 'imageAlbum', batchId: bid, messages: batch });
      } else {
        groupedChrono.push({ type: 'message', message: m });
      }
      i = j;
    } else {
      groupedChrono.push({ type: 'message', message: m });
      i++;
    }
  }
  groupedChrono.reverse();
  return groupedChrono;
}
