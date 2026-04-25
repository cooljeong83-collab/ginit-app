/**
 * "내가 방금(클라이언트에서) 모임 정보를 바꾼" 사실을 잠깐 기록해
 * 같은 기기에서만 in-app 알람/헤드업을 억제하기 위한 메모리 저장소입니다.
 *
 * 서버 권위는 유지되며(다른 참여자에게는 정상 알림), 이 값은 앱 재시작 시 사라집니다.
 */

const recentSelfWriteByMeetingId = new Map<string, number>();

/** 너무 길면 타인 변경까지 삼켜서 짧게 유지합니다. */
const SELF_WRITE_WINDOW_MS = 4000;

export function markRecentSelfMeetingChange(meetingId: string): void {
  const mid = meetingId.trim();
  if (!mid) return;
  recentSelfWriteByMeetingId.set(mid, Date.now());
}

export function wasRecentSelfMeetingChange(meetingId: string): boolean {
  const mid = meetingId.trim();
  if (!mid) return false;
  const t = recentSelfWriteByMeetingId.get(mid);
  if (!t) return false;
  if (Date.now() - t > SELF_WRITE_WINDOW_MS) {
    recentSelfWriteByMeetingId.delete(mid);
    return false;
  }
  return true;
}

export function sweepStaleSelfMeetingChanges(): void {
  const now = Date.now();
  for (const [mid, t] of recentSelfWriteByMeetingId) {
    if (now - t > SELF_WRITE_WINDOW_MS) recentSelfWriteByMeetingId.delete(mid);
  }
}

