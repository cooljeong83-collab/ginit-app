import { primaryScheduleFromDateCandidate, normalizeTimeInput } from '@/src/lib/date-candidate';
import type { DateCandidate, PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import type { Meeting } from '@/src/lib/meetings';
import { Linking, Platform } from 'react-native';

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

function dateCandidateChipId(d: DateCandidate, index: number): string {
  return d.id?.trim() || `dc-${index}`;
}

function placeCandidateChipId(p: { id?: string }, index: number): string {
  const pid = typeof p.id === 'string' ? p.id.trim() : '';
  return pid || `pc-${index}`;
}

function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  return { y, m: mo, d: da };
}

function localDateFromYmdAndHm(ymd: string, hmRaw: string | undefined): Date | null {
  const p = parseYmdParts(ymd);
  if (!p) return null;
  const hm = normalizeTimeInput(hmRaw ?? '') || '15:00';
  const tm = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!tm) return new Date(p.y, p.m - 1, p.d, 15, 0, 0, 0);
  const hh = Math.min(23, Math.max(0, Number(tm[1])));
  const mi = Math.min(59, Math.max(0, Number(tm[2])));
  return new Date(p.y, p.m - 1, p.d, hh, mi, 0, 0);
}

function findConfirmedDateCandidate(meeting: Meeting): DateCandidate | null {
  if (meeting.scheduleConfirmed !== true) return null;
  const cid = meeting.confirmedDateChipId?.trim();
  if (!cid) return null;
  const list = meeting.dateCandidates ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (dateCandidateChipId(list[i], i) === cid) return list[i];
  }
  return null;
}

function resolveConfirmedPlaceLine(meeting: Meeting): string | null {
  const id = meeting.confirmedPlaceChipId?.trim();
  if (!id) {
    const line = [meeting.placeName, meeting.address]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean)
      .join(' · ');
    return line || null;
  }
  const cands: PlaceCandidate[] = meeting.placeCandidates ?? [];
  for (let i = 0; i < cands.length; i += 1) {
    if (placeCandidateChipId(cands[i], i) !== id) continue;
    const title = cands[i].placeName?.trim() || '';
    const addr = cands[i].address?.trim() || '';
    const line = [title, addr].filter(Boolean).join(' · ');
    return line || null;
  }
  if (id === 'legacy-place') {
    const line = [meeting.placeName, meeting.address]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean)
      .join(' · ');
    return line || null;
  }
  return null;
}

export type ConfirmedMeetingCalendarPayload = {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  location: string | null;
  notes: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function ymdToCompact(ymd: string): string | null {
  const p = parseYmdParts(ymd);
  if (!p) return null;
  return `${p.y}${pad2(p.m)}${pad2(p.d)}`;
}

function dateToGcalUtcCompact(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildGoogleCalendarTemplateUrl(p: ConfirmedMeetingCalendarPayload): string {
  let datesParam: string;
  if (p.allDay) {
    const startKey = ymdKeyLocal(p.startDate);
    const endInclusive = ymdKeyLocal(p.endDate);
    const pEnd = parseYmdParts(endInclusive);
    if (!pEnd) {
      datesParam = `${ymdToCompact(startKey)}/${ymdToCompact(startKey)}`;
    } else {
      const endEx = new Date(pEnd.y, pEnd.m - 1, pEnd.d + 1);
      const exKey = ymdKeyLocal(endEx);
      const a = ymdToCompact(startKey);
      const b = ymdToCompact(exKey);
      datesParam = a && b ? `${a}/${b}` : `${a}/${a}`;
    }
  } else {
    datesParam = `${dateToGcalUtcCompact(p.startDate)}/${dateToGcalUtcCompact(p.endDate)}`;
  }
  const q = new URLSearchParams({ action: 'TEMPLATE', text: p.title, dates: datesParam, details: p.notes });
  if (p.location) q.set('location', p.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** 확정 일시가 있을 때만 OS 캘린더/웹 캘린더에 넣을 이벤트 구간을 만듭니다. */
export function buildConfirmedMeetingCalendarPayload(meeting: Meeting): ConfirmedMeetingCalendarPayload | null {
  const dc = findConfirmedDateCandidate(meeting);
  if (!dc) return null;

  const title = meeting.title?.trim() || '지닛 모임';
  const location = resolveConfirmedPlaceLine(meeting);
  const notesLines = ['지닛(Ginit) 모임 일정'];
  if (meeting.id) notesLines.push(`모임 ID: ${meeting.id}`);
  const notes = notesLines.join('\n');

  const t = dc.type;
  if (t === 'date-range') {
    const ay = (dc.startDate ?? '').trim();
    const by = (dc.endDate ?? '').trim();
    if (ay && by) {
      const p0 = parseYmdParts(ay);
      const p1 = parseYmdParts(by);
      if (p0 && p1) {
        const startDate = new Date(p0.y, p0.m - 1, p0.d, 0, 0, 0, 0);
        const endDate = new Date(p1.y, p1.m - 1, p1.d, 23, 59, 59, 999);
        return { title, startDate, endDate, allDay: true, location, notes };
      }
    }
  }

  if (t === 'datetime-range') {
    const startYmd = (dc.startDate ?? '').trim();
    const endYmd = (dc.endDate ?? '').trim();
    if (startYmd && endYmd) {
      const st = localDateFromYmdAndHm(startYmd, dc.startTime);
      const et = localDateFromYmdAndHm(endYmd, dc.endTime ?? dc.startTime);
      if (st && et) {
        const endDate = et > st ? et : new Date(st.getTime() + DEFAULT_DURATION_MS);
        return { title, startDate: st, endDate, allDay: false, location, notes };
      }
    }
  }

  const { scheduleDate, scheduleTime } = primaryScheduleFromDateCandidate(dc);
  const ymd = scheduleDate?.trim();
  if (!ymd) return null;
  const st = localDateFromYmdAndHm(ymd, scheduleTime);
  if (!st) return null;
  const endDate = new Date(st.getTime() + DEFAULT_DURATION_MS);
  return { title, startDate: st, endDate, allDay: false, location, notes };
}

/**
 * 확정 일정을 기기 캘린더에 추가합니다. (웹: 구글 캘린더 템플릿 링크)
 */
export async function saveConfirmedMeetingToDeviceCalendar(
  meeting: Meeting,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const payload = buildConfirmedMeetingCalendarPayload(meeting);
  if (!payload) return { ok: false, message: '저장할 확정 일시가 없어요.' };

  if (Platform.OS === 'web') {
    try {
      const url = buildGoogleCalendarTemplateUrl(payload);
      await Linking.openURL(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '캘린더를 열지 못했어요.' };
    }
  }

  try {
    const Calendar = await import('expo-calendar');
    const available = await Calendar.isAvailableAsync();
    if (!available) return { ok: false, message: '이 기기에서는 캘린더를 쓸 수 없어요.' };

    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== 'granted') {
      return { ok: false, message: '캘린더 권한이 필요해요. 설정에서 허용해 주세요.' };
    }

    let calendarId: string;
    if (Platform.OS === 'ios') {
      const def = await Calendar.getDefaultCalendarAsync();
      calendarId = def.id;
    } else {
      const cals = await Calendar.getCalendarsAsync();
      const writable = cals.filter((c) => c.allowsModifications);
      const prim = writable.find((c) => c.isPrimary) ?? writable[0];
      if (!prim) return { ok: false, message: '쓸 수 있는 캘린더가 없어요.' };
      calendarId = prim.id;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await Calendar.createEventAsync(calendarId, {
      title: payload.title,
      startDate: payload.startDate,
      endDate: payload.endDate,
      allDay: payload.allDay,
      location: payload.location ?? undefined,
      notes: payload.notes,
      alarms: [],
      ...(Platform.OS === 'ios' ? { timeZone } : {}),
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '일정을 저장하지 못했어요.' };
  }
}
