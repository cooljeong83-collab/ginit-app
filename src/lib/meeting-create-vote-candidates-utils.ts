import type { DatePickerField } from '@/components/create/DateCandidateEditorCard';
import {
  coerceDateCandidate,
  fmtDateYmd,
} from '@/src/lib/date-candidate';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';

export function clampHm(raw: string): string {
  const t = raw.trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (!m) return t;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return `${pad2(hh)}:${pad2(mm)}`;
}


export function dateFromYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const d = new Date(y, mo - 1, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d;
}

export function monthStartYmd(ymd: string): string {
  const d = dateFromYmd(ymd);
  if (!d) return fmtDate(new Date());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

type SpeechRecognitionErrorEvent = {
  error?: string;
  message?: string;
};

export function humanizeSpeechRecognitionError(event: SpeechRecognitionErrorEvent | null | undefined): string {
  const code = String(event?.error ?? '').trim();
  const rawMsg = String(event?.message ?? '').trim();

  const map: Record<string, string> = {
    'not-allowed': '마이크 또는 음성 인식 권한이 없어요. 설정에서 권한을 허용해 주세요.',
    'service-not-allowed':
      '이 기기에서 음성 인식 서비스를 사용할 수 없어요. (음성 인식/구글 음성 서비스 설정을 확인해 주세요)',
    'language-not-supported': '지원되지 않는 언어로 인식을 시작했어요. 한국어(ko-KR)로 다시 시도해 주세요.',
    network: '네트워크 문제로 음성 인식에 실패했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
    'no-speech': '말소리가 감지되지 않았어요. 조금 더 크게 말하거나 다시 시도해 주세요.',
    'audio-capture': '마이크 입력을 가져오지 못했어요. 다른 앱이 마이크를 사용 중인지 확인해 주세요.',
    aborted: '음성 인식이 중단되었어요.',
    interrupted: '다른 오디오(통화/알람 등) 때문에 음성 인식이 중단되었어요.',
    'bad-grammar': '음성 인식 요청 형식이 올바르지 않아요. 앱을 최신으로 업데이트한 뒤 다시 시도해 주세요.',
  };

  if (code && map[code]) return map[code];
  if (rawMsg) {
    if (/[가-힣]/.test(rawMsg)) return rawMsg;
    return `음성 인식에 실패했어요.\n\n원인: ${rawMsg}${code ? `\n코드: ${code}` : ''}`;
  }
  return '음성 인식에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

export function pickParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export function newId(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fmtTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function defaultScheduleTimePlus3Hours(): string {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return fmtTime(d);
}

export function weekendAnytimeMatches(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /주말\s*아무\s*때나|이번\s*주말\s*아무\s*때나|주말\s*(언제|아무)\s*(든|때나)|주말\s*아무때나/.test(t);
}

export const WEEKEND_ANYTIME_PREVIEW_COUNT = 5;

/** 이번·다음 주말의 여러 시각대 풀(미리보기에서 랜덤 샘플링) */
export function upcomingWeekendSlotPool(now: Date): { ymd: string; hm: string }[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);
  const min = new Date(base.getTime() + 3 * 60 * 60 * 1000);

  const day = base.getDay(); // 0 Sun .. 6 Sat
  const daysToSat = (6 - day + 7) % 7;
  const sat0 = new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysToSat, 0, 0, 0, 0);

  const mk = (d: Date, hh: number, mm: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);

  const hours = [11, 13, 15, 17, 19, 21];
  const candidates: Date[] = [];
  for (const weekOffset of [0, 7]) {
    const sat = new Date(sat0.getFullYear(), sat0.getMonth(), sat0.getDate() + weekOffset, 0, 0, 0, 0);
    const sun = new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1, 0, 0, 0, 0);
    for (const h of hours) {
      candidates.push(mk(sat, h, 0));
      candidates.push(mk(sun, h, 0));
    }
  }

  return candidates
    .filter((d) => d.getTime() >= min.getTime())
    .map((d) => ({ ymd: fmtDateYmd(d), hm: fmtTime(d) }));
}

export function pickRandomUniqueSlots(slots: { ymd: string; hm: string }[], count: number): { ymd: string; hm: string }[] {
  const a = slots.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  const out: { ymd: string; hm: string }[] = [];
  const seen = new Set<string>();
  for (const s of a) {
    const k = `${s.ymd}|${s.hm}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

export function forcePointCandidate(d: DateCandidate): DateCandidate {
  const startDate = String(d.startDate ?? '').trim() || fmtDate(new Date());
  const startTime = String(d.startTime ?? '').trim() || defaultScheduleTimePlus3Hours();
  return {
    ...d,
    type: 'point',
    startDate,
    startTime,
    endDate: undefined,
    endTime: undefined,
    subType: undefined,
    textLabel: undefined,
    isDeadlineSet: undefined,
  };
}

export function parseDateTimeStrings(dateStr: string, timeStr: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  const now = new Date();
  if (!dm) return now;
  const y = Number(dm[1]);
  const mo = Number(dm[2]) - 1;
  const day = Number(dm[3]);
  let hh = 12;
  let mm = 0;
  if (tm) {
    hh = Number(tm[1]);
    mm = Number(tm[2]);
  }
  return new Date(y, mo, day, hh, mm, 0, 0);
}

export function getPickerDraft(row: DateCandidate, field: DatePickerField): Date {
  switch (field) {
    case 'startDate':
    case 'startTime':
      return parseDateTimeStrings(row.startDate, row.startTime ?? '12:00');
  }
}

export function pickerFieldLabel(field: DatePickerField): string {
  switch (field) {
    case 'startDate':
      return '시작 날짜';
    case 'startTime':
      return '시작 시간';
  }
}

export type PlaceRowModel = {
  id: string;
  query: string;
  placeName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Supabase `places.place_key` */
  placeKey?: string;
  /** 네이버 검색·스크랩 업종 라벨 */
  category?: string;
  naverPlaceLink?: string;
  /** https 대표 사진 — 모임 저장 시 `placeCandidates[].preferredPhotoMediaUrl`로 전달 */
  preferredPhotoMediaUrl?: string;
};

export function emptyPlaceRow(seedQuery = ''): PlaceRowModel {
  return {
    id: newId('place'),
    query: seedQuery,
    placeName: '',
    address: '',
    latitude: null,
    longitude: null,
  };
}

export function isFilled(p: PlaceRowModel) {
  return p.latitude != null && p.longitude != null && p.placeName.trim().length > 0;
}

export function placeRowFromCandidate(p: PlaceCandidate): PlaceRowModel {
  const link = (p.naverPlaceLink ?? '').trim();
  const pref = typeof p.preferredPhotoMediaUrl === 'string' ? p.preferredPhotoMediaUrl.trim() : '';
  const cat = typeof p.category === 'string' ? p.category.trim() : '';
  const pk = typeof p.placeKey === 'string' ? p.placeKey.trim() : '';
  return {
    id: p.id,
    query: p.placeName,
    placeName: p.placeName,
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
    ...(pk ? { placeKey: pk } : {}),
    ...(cat ? { category: cat } : {}),
    ...(link ? { naverPlaceLink: link } : {}),
    ...(pref.startsWith('https://') ? { preferredPhotoMediaUrl: pref } : {}),
  };
}

export function buildInitialEditorState(
  initialPayload: VoteCandidatesPayload | null | undefined,
  seedQ: string,
  seedDate: string,
  seedTime: string,
): { placeCandidates: PlaceRowModel[]; dateCandidates: DateCandidate[] } {
  const todayStr = fmtDateYmd(new Date());
  const sdRaw = seedDate.trim();
  const safeSeedDate = /^\d{4}-\d{2}-\d{2}$/.test(sdRaw) ? (sdRaw < todayStr ? todayStr : sdRaw) : todayStr;

  const hasPayload =
    (initialPayload?.placeCandidates?.length ?? 0) > 0 || (initialPayload?.dateCandidates?.length ?? 0) > 0;
  if (hasPayload && initialPayload) {
    const dateCandidates: DateCandidate[] =
      initialPayload.dateCandidates.length > 0
        ? initialPayload.dateCandidates.map((d) => {
            const c = coerceDateCandidate(d, { startDate: safeSeedDate, startTime: seedTime });
            const raw = d as { id?: string };
            const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : newId('date');
            return forcePointCandidate({ ...c, id });
          })
        : [];
    const placeCandidates =
      initialPayload.placeCandidates.length > 0
        ? initialPayload.placeCandidates.map(placeRowFromCandidate)
        : [];
    return { placeCandidates, dateCandidates };
  }
  return {
    placeCandidates: [],
    dateCandidates: [],
  };
}
