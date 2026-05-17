import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { formatDateWithKoWeekday } from '@/src/lib/date-display';
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

/** FlashList `getItemType` — 텍스트 / 이미지 / 시스템 / 앨범 레이아웃 분리 */
export function meetingChatFlashListItemType(row: MeetingChatListRow): string {
  if (row.type === 'imageAlbum') return 'album';
  if (row.type === 'message' && row.message.kind === 'system') return 'system';
  if (row.type === 'message' && row.message.kind === 'image') return 'image';
  return 'text';
}

function rowAnchorDate(row: MeetingChatListRow): Date | null {
  if (row.type === 'message') return row.message.createdAt?.toDate?.() ?? null;
  return meetingChatAlbumAnchorMessage(row).createdAt?.toDate?.() ?? null;
}

/** inverted 목록 `index` 행 — 바로 위(과거) 이웃과 날짜가 다를 때만 일자 칩 문자열 */
export function meetingChatDateChipLabelAtIndex(rows: readonly MeetingChatListRow[], index: number): string {
  const row = rows[index];
  if (!row) return '';
  const next = index + 1 < rows.length ? rows[index + 1]! : null;
  const currDate = rowAnchorDate(row);
  const nextDate = next ? rowAnchorDate(next) : null;
  if (
    !currDate ||
    (nextDate &&
      currDate.getFullYear() === nextDate.getFullYear() &&
      currDate.getMonth() === nextDate.getMonth() &&
      currDate.getDate() === nextDate.getDate())
  ) {
    return '';
  }
  return formatDateWithKoWeekday(currDate);
}

function rowSenderNorm(row: MeetingChatListRow): string {
  if (row.type === 'message') {
    const s = row.message.senderId?.trim();
    return s ? normalizeParticipantId(s) : '';
  }
  const f = row.messages[0]?.senderId?.trim();
  return f ? normalizeParticipantId(f) : '';
}

function rowIsSystemRow(row: MeetingChatListRow): boolean {
  return row.type === 'message' && row.message.kind === 'system';
}

/**
 * inverted·최신순 목록에서 상대 말풍선 그룹의 **맨 위(더 과거 쪽) 한 줄**에만 아바타·닉네임.
 * `index === 0`(최신 1건) 예외는 제거 — 진입·동기화 직후 최하단에 프로필이 잠깐 떴다 사라지는 깜빡임 원인.
 */
export function meetingChatShowPeerAvatarAtIndex(
  rows: readonly MeetingChatListRow[],
  index: number,
  myNorm: string,
): boolean {
  const row = rows[index];
  if (!row) return false;
  const sid = rowSenderNorm(row);
  if (!sid || (myNorm && sid === myNorm)) return false;

  const next = index + 1 < rows.length ? rows[index + 1]! : null;
  if (!next) return true;
  if (rowIsSystemRow(next)) return true;
  const nextSid = rowSenderNorm(next);
  return !nextSid || nextSid !== sid;
}

/** FlashList `extraData` — `listRows` 구조·순서 변경 시 `renderItem` 재호출 */
export function meetingChatListExtraDataKey(rows: readonly MeetingChatListRow[]): string {
  if (rows.length === 0) return '';
  return rows.map((r) => meetingChatListRowKey(r)).join('\u0001');
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
