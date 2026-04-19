/**
 * 자연어 일정 입력 — 키워드·정규식 기반 (추후 AI API 연동 시 이 모듈만 교체·확장).
 */
import type { DateCandidate } from '@/src/lib/meeting-place-bridge';

export type ParsedSchedule =
  | { type: 'single'; at: Date; summary: string }
  | { type: 'range'; start: Date; end: Date; summary: string };

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function cloneDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0, 0);
}

function addDays(base: Date, days: number): Date {
  const x = cloneDate(base);
  x.setDate(x.getDate() + days);
  return x;
}

function setHhMm(d: Date, hh: number, mm: number): Date {
  const x = cloneDate(d);
  x.setHours(hh, mm, 0, 0);
  return x;
}

function fmtSummary(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtHm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function atMidnight(d: Date): Date {
  const x = cloneDate(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 날짜만(자정). */
export function parseDateOnly(text: string, now: Date): Date {
  return atMidnight(parseDateOnlyAndTime(text, now));
}

function segmentHasTimeHint(s: string): boolean {
  return /\d{1,2}시|오후|오전|저녁|밤|새벽|점심|:\d{2}/.test(s);
}

export type SmartNlpResult = {
  summary: string;
  candidate: Omit<DateCandidate, 'id'>;
};

/**
 * 8가지 DateCandidate.type 중 하나로 자연어를 해석 (프론트 테스트용 키워드·정규식).
 */
export function parseSmartNaturalSchedule(raw: string, now: Date = new Date()): SmartNlpResult | null {
  const text = raw.trim();
  if (!text) return null;

  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  const todayYmd = fmtYmd(ref);

  if (/^(미정|TBD|tbd|나중에|일정\s*미정)\b/i.test(text) || (/^\s*미정\s*$/.test(text) && text.length <= 6)) {
    return {
      summary: '일정 미정 (TBD)',
      candidate: { type: 'tbd', startDate: todayYmd },
    };
  }

  const deadlineTail = /(.+?)(?:까지\s*마감|신청\s*마감|등록\s*마감|마감\s*일|마감)/.exec(text);
  if (deadlineTail && !/매\s*주|매\s*일|매\s*월/.test(text)) {
    const endAt = parseDateOnlyAndTime(deadlineTail[1].trim(), now);
    const end = cloneDate(endAt);
    return {
      summary: `마감 ${fmtSummary(end)}`,
      candidate: {
        type: 'deadline',
        startDate: todayYmd,
        startTime: '09:00',
        endDate: fmtYmd(end),
        endTime: fmtHm(end),
        isDeadlineSet: true,
      },
    };
  }

  if (/매\s*일|매일/.test(text)) {
    const { hour, minute } = extractTime(text, 9, 0);
    const d = setHhMm(atMidnight(ref), hour, minute);
    return {
      summary: `매일 ${fmtHm(d)}`,
      candidate: { type: 'recurring', subType: 'daily', startDate: todayYmd, startTime: fmtHm(d) },
    };
  }

  if (/매\s*월/.test(text)) {
    const { hour, minute } = extractTime(text, 12, 0);
    const d = setHhMm(atMidnight(ref), hour, minute);
    return {
      summary: `매월 ${fmtHm(d)}`,
      candidate: { type: 'recurring', subType: 'monthly', startDate: todayYmd, startTime: fmtHm(d) },
    };
  }

  if (/매\s*주/.test(text)) {
    const rest = text.replace(/매\s*주\s*/g, '').trim();
    const day0 = weekdayFromKorean(rest, ref);
    const baseDay = day0 ?? upcomingSaturday(ref);
    const { hour, minute } = extractTime(text, 19, 0);
    const d = setHhMm(baseDay, hour, minute);
    return {
      summary: `매주 ${fmtYmd(baseDay)} ${fmtHm(d)}`,
      candidate: { type: 'recurring', subType: 'weekly', startDate: fmtYmd(baseDay), startTime: fmtHm(d) },
    };
  }

  const orSplit = /\s+(?:또는|혹은)\s+/.exec(text);
  if (orSplit && text.length >= 8) {
    const [a, b] = text.split(/\s+(?:또는|혹은)\s+/).map((s) => s.trim());
    if (a.length >= 2 && b.length >= 2) {
      return {
        summary: `여러 안: ${a.slice(0, 14)}…`,
        candidate: {
          type: 'multi',
          startDate: todayYmd,
          startTime: '12:00',
          textLabel: `${a} / ${b}`,
        },
      };
    }
  }

  const rangeBetween = /(.+?)부터\s*(.+?)까지/.exec(text);
  if (rangeBetween) {
    const s0 = rangeBetween[1].trim();
    const s1 = rangeBetween[2].trim();
    const useDatetime = segmentHasTimeHint(s0) || segmentHasTimeHint(s1);
    if (useDatetime) {
      const startAt = parseDateOnlyAndTime(s0, now);
      const endAt = parseDateOnlyAndTime(s1, now);
      let start = cloneDate(startAt);
      let end = cloneDate(endAt);
      if (end < start) [start, end] = [end, start];
      return {
        summary: `${fmtSummary(start)} → ${fmtSummary(end)}`,
        candidate: {
          type: 'datetime-range',
          startDate: fmtYmd(start),
          startTime: fmtHm(start),
          endDate: fmtYmd(end),
          endTime: fmtHm(end),
        },
      };
    }
    const d0 = parseDateOnly(s0, now);
    const d1 = parseDateOnly(s1, now);
    let a = cloneDate(d0);
    let b = cloneDate(d1);
    if (b < a) [a, b] = [b, a];
    return {
      summary: `${fmtYmd(a)} ~ ${fmtYmd(b)}`,
      candidate: { type: 'date-range', startDate: fmtYmd(a), endDate: fmtYmd(b) },
    };
  }

  const tilde = /\s~\s/.exec(text);
  if (tilde) {
    const [a, b] = text.split(/\s~\s/).map((s) => s.trim());
    if (a && b) {
      const useDatetime = segmentHasTimeHint(a) || segmentHasTimeHint(b);
      if (useDatetime) {
        const startAt = parseDateOnlyAndTime(a, now);
        const endAt = parseDateOnlyAndTime(b, now);
        let start = cloneDate(startAt);
        let end = cloneDate(endAt);
        if (end < start) [start, end] = [end, start];
        return {
          summary: `${fmtSummary(start)} → ${fmtSummary(end)}`,
          candidate: {
            type: 'datetime-range',
            startDate: fmtYmd(start),
            startTime: fmtHm(start),
            endDate: fmtYmd(end),
            endTime: fmtHm(end),
          },
        };
      }
      const d0 = parseDateOnly(a, now);
      const d1 = parseDateOnly(b, now);
      let x = cloneDate(d0);
      let y = cloneDate(d1);
      if (y < x) [x, y] = [y, x];
      return {
        summary: `${fmtYmd(x)} ~ ${fmtYmd(y)}`,
        candidate: { type: 'date-range', startDate: fmtYmd(x), endDate: fmtYmd(y) },
      };
    }
  }

  const n박m일 = /(\d+)\s*박\s*(\d+)\s*일/.exec(text);
  if (n박m일 || /1\s*박\s*2\s*일/i.test(text)) {
    const stripped = text
      .replace(/\d+\s*박\s*\d+\s*일/g, '')
      .replace(/1\s*박\s*2\s*일/gi, '')
      .trim();
    const base = parseDateOnlyAndTime(stripped || '내일', now);
    let daysSpan = 2;
    if (n박m일) {
      daysSpan = Math.max(1, Number(n박m일[2]) - 1 || 1);
    }
    const start = setHhMm(cloneDate(base), 15, 0);
    const end = setHhMm(addDays(start, daysSpan), 11, 0);
    return {
      summary: `${fmtSummary(start)} → ${fmtSummary(end)} (기간)`,
      candidate: {
        type: 'datetime-range',
        startDate: fmtYmd(start),
        startTime: fmtHm(start),
        endDate: fmtYmd(end),
        endTime: fmtHm(end),
      },
    };
  }

  const dateHint =
    /내일|오늘|모레|글피|주말|월요일|화요일|수요일|목요일|금요일|토요일|일요일|\d{1,2}월\s*\d{1,2}일|\d{1,2}일/.test(text);
  const strongFlex = /시험.*?끝|끝나고|유연하게|비슷하게|대략|쯤/.test(text);
  const looseFlex = /아무\s*때나|늦게/.test(text);
  if (strongFlex || (looseFlex && !dateHint) || (text.length >= 22 && !dateHint)) {
    const at = parseDateOnlyAndTime(text, now);
    return {
      summary: `유연 일정 · ${fmtSummary(at)}`,
      candidate: {
        type: 'flexible',
        startDate: fmtYmd(at),
        startTime: fmtHm(at),
        textLabel: text,
      },
    };
  }

  const at = parseDateOnlyAndTime(text, now);
  return {
    summary: fmtSummary(at),
    candidate: { type: 'point', startDate: fmtYmd(at), startTime: fmtHm(at) },
  };
}

/** 다음(또는 이번) 토요일 00:00 기준 날짜만 */
function upcomingSaturday(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
  const dow = d.getDay();
  const add = dow === 6 ? 7 : (6 - dow + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d;
}

function extractTime(text: string, defaultHour: number, defaultMinute: number): { hour: number; minute: number } {
  if (/저녁|밤/.test(text)) {
    const m = /(\d{1,2})시(?:(\d{1,2})분)?/.exec(text);
    if (m) {
      let h = Number(m[1]);
      if (h > 0 && h < 12) h += 12;
      return { hour: h, minute: m[2] ? Number(m[2]) : 0 };
    }
    return { hour: 19, minute: 0 };
  }

  if (/오전|새벽/.test(text)) {
    const m = /(\d{1,2})시(?:(\d{1,2})분)?/.exec(text);
    if (m) return { hour: Number(m[1]) % 24, minute: m[2] ? Number(m[2]) : 0 };
  }

  if (/오후/.test(text)) {
    const m = /(\d{1,2})시(?:(\d{1,2})분)?/.exec(text);
    if (m) {
      let h = Number(m[1]);
      if (h < 12) h += 12;
      return { hour: h, minute: m[2] ? Number(m[2]) : 0 };
    }
  }

  const colon = /(\d{1,2}):(\d{2})/.exec(text);
  if (colon) return { hour: Number(colon[1]), minute: Number(colon[2]) };

  const si = /(\d{1,2})시(?:\s*(\d{1,2})분)?/.exec(text);
  if (si) {
    let h = Number(si[1]);
    const mm = si[2] ? Number(si[2]) : 0;
    if (/오후/.test(text) && h < 12) h += 12;
    else if (!/오전|오후|저녁|밤|새벽/.test(text) && h >= 1 && h <= 11) h += 12;
    return { hour: h, minute: mm };
  }

  if (/점심/.test(text)) return { hour: 12, minute: 0 };
  if (/아침/.test(text)) return { hour: 9, minute: 0 };

  return { hour: defaultHour, minute: defaultMinute };
}

function weekdayFromKorean(text: string, from: Date): Date | null {
  const pairs: [string, number][] = [
    ['일요일', 0],
    ['월요일', 1],
    ['화요일', 2],
    ['수요일', 3],
    ['목요일', 4],
    ['금요일', 5],
    ['토요일', 6],
  ];
  for (const [name, targetDow] of pairs) {
    if (text.includes(name)) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
      const dow = d.getDay();
      let add = (targetDow - dow + 7) % 7;
      if (add === 0) add = 7;
      d.setDate(d.getDate() + add);
      return d;
    }
  }
  return null;
}

/**
 * 날짜(상대/요일) + 시간만 해석 (기간 키워드 제외한 조각용).
 */
export function parseDateOnlyAndTime(text: string, now: Date): Date {
  const t = text.trim();
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);

  let day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);

  if (/오늘/.test(t)) {
    day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
  } else if (/내일/.test(t)) {
    day = addDays(ref, 1);
    day.setHours(0, 0, 0, 0);
  } else if (/모레|명일/.test(t)) {
    day = addDays(ref, 2);
    day.setHours(0, 0, 0, 0);
  } else if (/글피/.test(t)) {
    day = addDays(ref, 3);
    day.setHours(0, 0, 0, 0);
  } else if (/이번\s*주말|주말/.test(t)) {
    day = upcomingSaturday(ref);
  } else {
    const md = /(\d{1,2})월\s*(\d{1,2})일/.exec(t);
    if (md) {
      let y = ref.getFullYear();
      const mo = Number(md[1]) - 1;
      const dd = Number(md[2]);
      const cand = new Date(y, mo, dd, 0, 0, 0, 0);
      if (cand < new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0)) {
        y += 1;
      }
      day = new Date(y, mo, dd, 0, 0, 0, 0);
    } else {
      const wd = weekdayFromKorean(t, ref);
      if (wd) day = wd;
    }
  }

  const { hour, minute } = extractTime(t, 15, 0);
  return setHhMm(day, hour, minute);
}

/**
 * 자연어 문자열 → 단일 일시 또는 기간(시작·종료).
 */
export function parseNaturalSchedule(raw: string, now: Date = new Date()): ParsedSchedule | null {
  const text = raw.trim();
  if (!text) return null;

  const rangeBetween = /(.+?)부터\s*(.+?)까지/.exec(text);
  if (rangeBetween) {
    const startAt = parseDateOnlyAndTime(rangeBetween[1].trim(), now);
    const endAt = parseDateOnlyAndTime(rangeBetween[2].trim(), now);
    let start = cloneDate(startAt);
    let end = cloneDate(endAt);
    if (end < start) [start, end] = [end, start];
    return {
      type: 'range',
      start,
      end,
      summary: `${fmtSummary(start)} ~ ${fmtSummary(end)}`,
    };
  }

  const tilde = /\s~\s/.exec(text);
  if (tilde) {
    const [a, b] = text.split(/\s~\s/).map((s) => s.trim());
    if (a && b) {
      const startAt = parseDateOnlyAndTime(a, now);
      const endAt = parseDateOnlyAndTime(b, now);
      let start = cloneDate(startAt);
      let end = cloneDate(endAt);
      if (end < start) [start, end] = [end, start];
      return {
        type: 'range',
        start,
        end,
        summary: `${fmtSummary(start)} ~ ${fmtSummary(end)}`,
      };
    }
  }

  const n박m일 = /(\d+)\s*박\s*(\d+)\s*일/.exec(text);
  if (n박m일 || /1\s*박\s*2\s*일/i.test(text)) {
    const stripped = text
      .replace(/\d+\s*박\s*\d+\s*일/g, '')
      .replace(/1\s*박\s*2\s*일/gi, '')
      .trim();
    const base = parseDateOnlyAndTime(stripped || '내일', now);
    let daysSpan = 2;
    if (n박m일) {
      daysSpan = Math.max(1, Number(n박m일[2]) - 1 || 1);
    }
    const start = setHhMm(cloneDate(base), 15, 0);
    const end = setHhMm(addDays(start, daysSpan), 11, 0);
    return {
      type: 'range',
      start,
      end,
      summary: `${fmtSummary(start)} ~ ${fmtSummary(end)} (기간)`,
    };
  }

  const at = parseDateOnlyAndTime(text, now);
  return { type: 'single', at, summary: fmtSummary(at) };
}
