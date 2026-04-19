/**
 * DateCandidate 스마트 일정 — 정규화·검증·레거시 호환·Firestore primary 필드 도출.
 */
import type { DateCandidate, DateCandidateType } from '@/src/lib/meeting-place-bridge';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function fmtDateYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fmtTimeHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 모임 문서 상단 `scheduleDate` / `scheduleTime` (첫 후보 기준). */
export function primaryScheduleFromDateCandidate(d: DateCandidate): { scheduleDate: string; scheduleTime: string } {
  switch (d.type) {
    case 'deadline':
      return {
        scheduleDate: (d.endDate ?? d.startDate).trim(),
        scheduleTime: (d.endTime ?? '23:59').trim(),
      };
    case 'tbd':
      return { scheduleDate: d.startDate.trim(), scheduleTime: (d.startTime ?? '12:00').trim() };
    case 'point':
    case 'date-range':
    case 'datetime-range':
    case 'recurring':
    case 'multi':
    case 'flexible':
    default:
      return {
        scheduleDate: d.startDate.trim(),
        scheduleTime: (d.startTime ?? '15:00').trim(),
      };
  }
}

export function createPointCandidate(id: string, startDate: string, startTime: string): DateCandidate {
  return { id, type: 'point', startDate, startTime };
}

export function coerceDateCandidate(raw: unknown, fallback: { startDate: string; startTime: string }): DateCandidate {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      type: 'point',
      startDate: fallback.startDate,
      startTime: fallback.startTime,
    };
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  const legacyDate = o.scheduleDate;
  const legacyTime = o.scheduleTime;
  if (typeof legacyDate === 'string' && typeof legacyTime === 'string' && !o.type) {
    return { id, type: 'point', startDate: legacyDate, startTime: legacyTime };
  }
  const type = (typeof o.type === 'string' ? o.type : 'point') as DateCandidateType;
  const startDate = typeof o.startDate === 'string' ? o.startDate : fallback.startDate;
  const startTime = typeof o.startTime === 'string' ? o.startTime : fallback.startTime;
  const base: DateCandidate = {
    id,
    type: ['point', 'date-range', 'datetime-range', 'recurring', 'multi', 'flexible', 'tbd', 'deadline'].includes(type)
      ? type
      : 'point',
    startDate,
    startTime,
    endDate: typeof o.endDate === 'string' ? o.endDate : undefined,
    endTime: typeof o.endTime === 'string' ? o.endTime : undefined,
    textLabel: typeof o.textLabel === 'string' ? o.textLabel : undefined,
    subType: o.subType === 'daily' || o.subType === 'weekly' || o.subType === 'monthly' ? o.subType : undefined,
    isDeadlineSet: typeof o.isDeadlineSet === 'boolean' ? o.isDeadlineSet : undefined,
  };
  return base;
}

function validDate(s: string): boolean {
  return DATE_RE.test(s.trim());
}

export function normalizeTimeInput(t: string | undefined): string {
  if (t == null || !t.trim()) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return t.trim();
  return `${pad2(Number(m[1]))}:${m[2]}`;
}

/** `buildPayload` 검증 — 오류 메시지 또는 null. */
export function validateDateCandidate(d: DateCandidate, index: number): string | null {
  const label = `일시 후보 ${index + 1}`;
  if (!validDate(d.startDate)) {
    return `${label}: 시작 날짜는 YYYY-MM-DD 형식이어야 합니다.`;
  }
  switch (d.type) {
    case 'point': {
      const nt = normalizeTimeInput(d.startTime);
      if (!nt || !TIME_RE.test(nt)) {
        return `${label}: 시간은 HH:mm 형식이어야 합니다.`;
      }
      break;
    }
    case 'date-range':
      if (!d.endDate?.trim() || !validDate(d.endDate)) {
        return `${label}: 종료 날짜(YYYY-MM-DD)를 입력해 주세요.`;
      }
      if (d.startTime != null && d.startTime !== '' && !TIME_RE.test(normalizeTimeInput(d.startTime))) {
        return `${label}: 시작 시간 형식을 확인해 주세요.`;
      }
      if (d.endTime != null && d.endTime !== '' && !TIME_RE.test(normalizeTimeInput(d.endTime))) {
        return `${label}: 종료 시간 형식을 확인해 주세요.`;
      }
      break;
    case 'datetime-range':
      if (!d.endDate?.trim() || !validDate(d.endDate)) {
        return `${label}: 종료 날짜를 입력해 주세요.`;
      }
      if (!d.startTime?.trim() || !TIME_RE.test(normalizeTimeInput(d.startTime))) {
        return `${label}: 시작 시간은 HH:mm 형식이어야 합니다.`;
      }
      if (!d.endTime?.trim() || !TIME_RE.test(normalizeTimeInput(d.endTime))) {
        return `${label}: 종료 시간은 HH:mm 형식이어야 합니다.`;
      }
      break;
    case 'recurring':
      if (!d.subType) {
        return `${label}: 반복 주기(매일/매주/매월)를 선택해 주세요.`;
      }
      if (!d.startTime?.trim() || !TIME_RE.test(normalizeTimeInput(d.startTime))) {
        return `${label}: 반복 일정의 기준 시간은 HH:mm 형식이어야 합니다.`;
      }
      break;
    case 'multi':
      if (!d.textLabel?.trim() || d.textLabel.trim().length < 2) {
        return `${label}: 여러 안을 설명하는 문구를 입력해 주세요.`;
      }
      break;
    case 'flexible':
      if (!d.textLabel?.trim() || d.textLabel.trim().length < 2) {
        return `${label}: 유연 일정 설명을 입력해 주세요.`;
      }
      break;
    case 'tbd':
      break;
    case 'deadline':
      if (!d.isDeadlineSet) {
        return `${label}: 마감 일정으로 표시되지 않았습니다.`;
      }
      if (!d.endDate?.trim() || !validDate(d.endDate)) {
        return `${label}: 마감 날짜를 입력해 주세요.`;
      }
      if (!d.endTime?.trim() || !TIME_RE.test(normalizeTimeInput(d.endTime))) {
        return `${label}: 마감 시간은 HH:mm 형식이어야 합니다.`;
      }
      break;
    default:
      break;
  }
  return null;
}

/** n박 m일 뱃지용 (자정 기준 일 수). */
export function rangeNightsBadge(startYmd: string, endYmd: string): string | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startYmd.trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endYmd.trim());
  if (!a || !b) return null;
  const t0 = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 0, 0, 0, 0).getTime();
  const t1 = new Date(Number(b[1]), Number(b[2]) - 1, Number(b[3]), 0, 0, 0, 0).getTime();
  const days = Math.round((t1 - t0) / (24 * 60 * 60 * 1000));
  if (days < 1) return null;
  const nights = days;
  const daysTotal = days + 1;
  return `${nights}박 ${daysTotal}일`;
}
