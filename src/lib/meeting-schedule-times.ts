import { Timestamp } from 'firebase/firestore';

/** `YYYY-MM-DD` + `H:mm` 또는 `HH:mm` → Firestore Timestamp (파싱 실패 시 null). */
export function parseScheduleToTimestamp(dateStr: string, timeStr: string): Timestamp | null {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const hh = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const dt = new Date(`${d}T${hh}:${mm}:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return Timestamp.fromDate(dt);
}

/** 피드·일정 겹침 등에서 쓰는 최소 필드만 요구합니다. */
export type MeetingScheduleTimeFields = {
  scheduledAt?: unknown;
  scheduleDate?: string | null;
  scheduleTime?: string | null;
};

/** `scheduledAt` 또는 `scheduleDate`+`scheduleTime` 기준 시작 epoch ms. */
export function meetingScheduleStartMs(m: MeetingScheduleTimeFields): number | null {
  const sa = m.scheduledAt;
  if (sa && typeof (sa as { toMillis?: () => number }).toMillis === 'function') {
    return (sa as { toMillis: () => number }).toMillis();
  }
  const d = m.scheduleDate?.trim() ?? '';
  const t = m.scheduleTime?.trim() ?? '';
  if (!d || !t) return null;
  const ts = parseScheduleToTimestamp(d, t);
  return ts ? ts.toMillis() : null;
}
