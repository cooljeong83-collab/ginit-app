import { Timestamp } from '@/src/lib/ginit-timestamp';

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

/** `scheduleConfirmed === true`이고 시작 시각을 알 수 있을 때만, `nowMs`가 예정 시작 N분 전 이후면 true(확정 취소 UI 숨김·차단) */
export function isHostScheduleUnconfirmHiddenByStartProximity(
  m: MeetingScheduleUnconfirmTimeGateFields,
  nowMs: number,
  beforeMin = 0,
): boolean {
  if (m.scheduleConfirmed !== true) return false;
  const startMs = meetingScheduleStartMs(m);
  if (startMs == null) return false;
  const beforeMs = Math.max(0, Math.trunc(beforeMin)) * 60_000;
  return nowMs >= startMs - beforeMs;
}

/** `trust.penalty_near_meeting_cancel_window_hours` — `0111` 시드와 동일 */
export type NearMeetingCancelPenaltyWindow = { outerHours: number; innerHours: number };

export function parseNearMeetingCancelPenaltyWindowPolicy(raw: unknown): NearMeetingCancelPenaltyWindow {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return null;
      const x = Number(t);
      return Number.isFinite(x) ? x : null;
    }
    return null;
  };
  const legacyH = n(o.hours);
  const outerCand = n(o.outer_hours) ?? legacyH;
  const innerCand = n(o.inner_hours) ?? legacyH;
  let outerHours = outerCand != null && outerCand > 0 ? outerCand : 2;
  let innerHours = innerCand != null && innerCand > 0 ? innerCand : 1;
  outerHours = Math.min(168, Math.max(1 / 60, outerHours));
  innerHours = Math.min(168, Math.max(1 / 60, innerHours));
  if (innerHours > outerHours) innerHours = outerHours;
  return { outerHours, innerHours };
}

export type TrustPenaltyLeaveNearMeetingTier = 'none' | 'soft' | 'full';

/** 예정 시작 전 `outer`~`inner` 구간은 완화 패널티(soft), `inner` 이내는 전체 패널티(full). */
export function getTrustPenaltyLeaveNearMeetingTier(
  m: MeetingScheduleTimeFields,
  nowMs: number,
  win: NearMeetingCancelPenaltyWindow,
): TrustPenaltyLeaveNearMeetingTier {
  const startMs = meetingScheduleStartMs(m);
  if (startMs == null) return 'none';
  if (!Number.isFinite(win.outerHours) || win.outerHours <= 0) return 'none';
  if (nowMs >= startMs) return 'none';
  const msToStart = startMs - nowMs;
  const outerMs = win.outerHours * 60 * 60 * 1000;
  if (msToStart > outerMs) return 'none';
  const innerMs = Math.min(win.innerHours * 60 * 60 * 1000, outerMs);
  if (msToStart <= innerMs) return 'full';
  return 'soft';
}

/**
 * 예정 시작 전 외부 창(기본 2시간) 이내·시작 전이면 true — 신뢰 패널티(퇴장·호스트 확정 취소) RPC 적용 여부.
 * `policyRaw`는 `trust.penalty_near_meeting_cancel_window_hours` JSON.
 */
export function shouldApplyTrustPenaltyForCancelNearMeetingStart(
  m: MeetingScheduleTimeFields,
  nowMs: number,
  policyRaw: unknown,
): boolean {
  return getTrustPenaltyLeaveNearMeetingTier(m, nowMs, parseNearMeetingCancelPenaltyWindowPolicy(policyRaw)) !== 'none';
}
