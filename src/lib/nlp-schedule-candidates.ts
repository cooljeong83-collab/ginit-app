import type { DateCandidate } from '@/src/lib/meeting-place-bridge';
import type { SmartNlpResult } from '@/src/lib/natural-language-schedule';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function newId(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export type NlpApplyResult = {
  next: DateCandidate[];
  expandRowId: string | null;
  shouldAutoExpand: boolean;
  didAppend: boolean;
};

/** NLP 프리뷰를 일정 후보로 반영 — 정책: 항상 append */
export function computeNlpApply(prev: DateCandidate[], nlp: SmartNlpResult): NlpApplyResult {
  const nid = newId('date');
  return {
    next: [...prev, { ...nlp.candidate, id: nid }],
    expandRowId: nid,
    shouldAutoExpand: nlp.candidate.type !== 'point',
    didAppend: true,
  };
}

export function normalizeHm(raw: string | null | undefined): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${pad2(hh)}:${pad2(mm)}`;
}

/** 일정 후보 중복 판정용 키(표시/집계에 의미 있는 필드 포함). */
export function dateCandidateDupKey(d: DateCandidate): string {
  const type = d.type ?? 'point';
  const sd = String(d.startDate ?? '').trim();
  const st = normalizeHm(d.startTime);
  const ed = String(d.endDate ?? '').trim();
  const et = normalizeHm(d.endTime);
  const sub = String(d.subType ?? '').trim();
  const txt = String(d.textLabel ?? '').trim();
  const deadline = d.isDeadlineSet ? '1' : '';
  return `${type}|${sd}|${st}|${ed}|${et}|${sub}|${deadline}|${txt}`;
}

