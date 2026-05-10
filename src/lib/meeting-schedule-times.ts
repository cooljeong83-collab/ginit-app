import { Timestamp } from 'firebase/firestore';

/** `YYYY-MM-DD` + `H:mm` 또는 `HH:mm` → Firestore Timestamp (파싱 실패 시 null). */
export function parseScheduleToTimestamp(dateStr: string, timeStr: string): Timestamp | null {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
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

/** Firestore Timestamp·ISO 문자열·epoch ms·JSON `{ seconds }` 등 → epoch ms (실패 시 null). */
export function coerceScheduledAtToEpochMs(scheduledAt: unknown): number | null {
  if (scheduledAt == null) return null;
  if (typeof scheduledAt === 'string') {
    const d = new Date(scheduledAt.trim());
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  if (typeof scheduledAt === 'number' && Number.isFinite(scheduledAt)) {
    return scheduledAt;
  }
  if (typeof scheduledAt === 'object' && scheduledAt !== null) {
    const toMillis = (scheduledAt as { toMillis?: () => number }).toMillis;
    if (typeof toMillis === 'function') {
      try {
        const ms = toMillis.call(scheduledAt);
        return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    }
    const o = scheduledAt as Record<string, unknown>;
    const sec = o.seconds ?? o._seconds;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      const nano = o.nanoseconds ?? o._nanoseconds;
      const n = typeof nano === 'number' && Number.isFinite(nano) ? nano : 0;
      return sec * 1000 + Math.floor(n / 1e6);
    }
  }
  return null;
}

/** `scheduledAt` 또는 `scheduleDate`+`scheduleTime` 기준 시작 epoch ms. */
export function meetingScheduleStartMs(m: MeetingScheduleTimeFields): number | null {
  const fromSa = coerceScheduledAtToEpochMs(m.scheduledAt);
  if (fromSa != null) return fromSa;
  const d = m.scheduleDate?.trim() ?? '';
  const t = m.scheduleTime?.trim() ?? '';
  if (!d || !t) return null;
  const ts = parseScheduleToTimestamp(d, t);
  return ts ? ts.toMillis() : null;
}

export type MeetingScheduleUnconfirmTimeGateFields = MeetingScheduleTimeFields & {
  scheduleConfirmed?: boolean | null;
};

/** `scheduleConfirmed === true`이고 시작 시각을 알 수 있을 때만, `nowMs`가 예정 시작 시각 이후면 true(확정 취소 UI 숨김·차단) */
export function isHostScheduleUnconfirmHiddenByStartProximity(
  m: MeetingScheduleUnconfirmTimeGateFields,
  nowMs: number,
): boolean {
  if (m.scheduleConfirmed !== true) return false;
  const startMs = meetingScheduleStartMs(m);
  if (startMs == null) return false;
  return nowMs >= startMs;
}
