import type { AgentTimeSlot, AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';
import {
  combineYmdHmToLocalDate,
  createPointCandidate,
  fmtDateYmd,
  fmtTimeHm,
  validateDateCandidate,
} from '@/src/lib/date-candidate';

function slotToHm(slot: AgentTimeSlot): string {
  switch (slot) {
    case 'morning':
      return '10:00';
    case 'lunch':
      return '12:30';
    case 'afternoon':
      return '15:00';
    case 'evening':
      return '19:00';
    case 'night':
      return '21:00';
    default:
      return '19:00';
  }
}

function bumpYmdHm(ymd: string, hm: string, addMinutes: number): { ymd: string; hm: string } {
  const d = combineYmdHmToLocalDate(ymd.trim(), hm.trim());
  if (!d) return { ymd, hm };
  d.setMinutes(d.getMinutes() + addMinutes);
  return { ymd: fmtDateYmd(d), hm: fmtTimeHm(d) };
}

/**
 * FAB 자동 일정 1안 — 참여 습관(주말 비중 등)과 현재 시간대 슬롯을 반영한 뒤,
 * `validateDateCandidate`(최소 1시간 리드 등)을 통과하도록 앞으로만 보정합니다.
 */
export function pickAutoWizardScheduleFromSnapshot(s: AgentWelcomeSnapshot): { ymd: string; hm: string } {
  const now = s.now instanceof Date && !Number.isNaN(s.now.getTime()) ? s.now : new Date();
  const todayYmd = fmtDateYmd(now);
  const h = s.meetingHabits;

  let ymd = todayYmd;
  let hm = slotToHm(s.timeSlot);

  if (h?.nextSaturdayYmd && h.nextSaturdayYmd >= todayYmd && (h.weekendDayPortion ?? 0) >= 0.35) {
    ymd = h.nextSaturdayYmd;
    hm = '19:00';
  }

  for (let i = 0; i < 600; i += 1) {
    const c = createPointCandidate('auto-wizard-probe', ymd, hm);
    const err = validateDateCandidate(c, 0, now);
    if (!err) {
      return { ymd, hm };
    }
    const next = bumpYmdHm(ymd, hm, 15);
    ymd = next.ymd;
    hm = next.hm;
  }

  const fallback = bumpYmdHm(todayYmd, '12:00', 120);
  return fallback;
}
