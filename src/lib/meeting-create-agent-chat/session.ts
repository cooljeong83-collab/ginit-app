/**
 * 모임 생성 NLU 멀티턴 대화 — 누적 JSON 병합·히스토리 문자열·간단 휴리스틱.
 */

export type MeetingCreateAgentChatRole = 'user' | 'assistant';

export type MeetingCreateAgentChatMessage = {
  role: MeetingCreateAgentChatRole;
  text: string;
  ts: number;
};

export type MeetingCreateAgentChatSession = {
  messages: MeetingCreateAgentChatMessage[];
};

export function createEmptyMeetingCreateAgentChatSession(): MeetingCreateAgentChatSession {
  return { messages: [] };
}

export function appendMeetingCreateAgentChatMessage(
  session: MeetingCreateAgentChatSession,
  role: MeetingCreateAgentChatRole,
  text: string,
  ts: number = Date.now(),
): MeetingCreateAgentChatSession {
  const t = text.trim();
  if (!t) return session;
  return { messages: [...session.messages, { role, text: t, ts }] };
}

/** Edge `history`용 — 최근 사용자·어시스턴트 턴을 짧은 문자열로 */
export function meetingCreateAgentChatHistoryLines(
  session: MeetingCreateAgentChatSession,
  maxPairs: number,
): string[] {
  const lines: string[] = [];
  const msgs = session.messages;
  let userCount = 0;
  for (let i = msgs.length - 1; i >= 0 && userCount < maxPairs; i -= 1) {
    const m = msgs[i];
    if (!m) break;
    const label = m.role === 'user' ? '사용자' : '어시스턴트';
    lines.unshift(`${label}: ${m.text}`);
    if (m.role === 'user') userCount += 1;
  }
  return lines.slice(-maxPairs * 2);
}

function clipMeetingCreateHistoryText(s: string, maxChars: number): string {
  const t = s.normalize('NFKC').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * NLU Edge `history` — 방금 붙인 **현재 사용자 한 줄은 제외**하고, 최근 `maxTurns`쌍(사용자+어시스턴트)만 슬라이딩.
 * 턴당 문자 상한으로 토큰 절약.
 */
export function meetingCreateAgentChatSlidingHistoryForEdge(
  session: MeetingCreateAgentChatSession,
  maxTurns: number = 3,
  maxCharsPerLine: number = 180,
): string {
  let msgs = session.messages;
  if (msgs.length > 0 && msgs[msgs.length - 1]?.role === 'user') {
    msgs = msgs.slice(0, -1);
  }
  const cap = Math.max(1, Math.min(maxTurns, 5)) * 2;
  const tail = msgs.slice(-cap);
  return tail
    .map((m) => {
      const label = m.role === 'user' ? '사용자' : '어시스턴트';
      return `${label}: ${clipMeetingCreateHistoryText(m.text, maxCharsPerLine)}`;
    })
    .join('\n');
}

/** 첫 턴 인사만으로 보일 때(모델 없이 빠른 응답 가능) */
export function isLikelyMeetingCreateGreetingOnly(text: string): boolean {
  const t = text.normalize('NFKC').trim().toLowerCase();
  if (t.length > 48) return false;
  /** 숫자·인원·일정·장소·모임 맥락이 있으면 인사 전용이 아님(짧은 ‘피시방’ ‘내일이요’ 등 오탐 방지) */
  if (/\d/.test(t)) return false;
  if (
    /(명|명이|명은|모이|모일|만나|약속|일정|장소|언제|어디|몇\s*시|시에|요일|내일|모레|다음주|주말|평일|저녁|오후|오전)/.test(t)
  ) {
    return false;
  }
  if (
    /(피시|피씨|pc\s*방|pc방|오락실|게임|카페|식당|영화관|극장|시네마|멀티플렉스|메가박스|롯데|cgv|역\s|에서|만나|룸|방\b)/i.test(
      t,
    )
  ) {
    return false;
  }
  const greeting =
    /^(안녕|하이|헬로|hello|hi|반가|좋은\s*(아침|점심|저녁|밤)|굿\s*(모닝|이브닝)|잘\s*지내|오랜만)/.test(t);
  const thin = t.length <= 18 && /^[가-힣\s,.!?~]+$/.test(t);
  return greeting || (thin && !/[모임일정장소인원카테고리]/.test(t));
}

import {
  combineMeetingCreatePlaceQuery,
} from '@/src/lib/meeting-create-nlu/local-intent-patch';

/**
 * Edge/클라이언트 공용: null/undefined 패치 값은 기존 누적을 덮지 않음.
 * 빈 문자열·빈 배열 패치는 누적에 이미 값이 있으면 무시(새 정보 없음으로 간주).
 * `인원`·`publicMeetingDetails`·`nluInference`는 null/undefined 하위 키는 병합 시 제외.
 * `placeAutoPickQuery`/`장소`: 누적이 역·동 등 지역만이면 이번 턴 업종만 덮어쓰지 않고 합친다.
 */
function omitNullishRecordEntries(src: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [kk, vv] of Object.entries(src)) {
    if (vv !== null && vv !== undefined) o[kk] = vv;
  }
  return o;
}

export function mergeMeetingCreateNluAccumulated(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  let placeKeysDone = false;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k === 'placeAutoPickQuery' || k === '장소') {
      if (placeKeysDone) continue;
      placeKeysDone = true;
      const patchPlace = String(patch.placeAutoPickQuery ?? patch['장소'] ?? v).trim();
      if (!patchPlace) continue;
      const prevPlace = String(out.placeAutoPickQuery ?? out['장소'] ?? '').trim();
      const mergedPlace = combineMeetingCreatePlaceQuery(prevPlace, patchPlace);
      out.placeAutoPickQuery = mergedPlace;
      out['장소'] = mergedPlace;
      continue;
    }
    if (k === '인원' && typeof v === 'object' && !Array.isArray(v)) {
      const prev =
        typeof out['인원'] === 'object' && out['인원'] !== null && !Array.isArray(out['인원'])
          ? (out['인원'] as Record<string, unknown>)
          : {};
      out['인원'] = { ...prev, ...omitNullishRecordEntries(v as Record<string, unknown>) };
      continue;
    }
    if (k === 'publicMeetingDetails' && typeof v === 'object' && !Array.isArray(v)) {
      const prev =
        typeof out.publicMeetingDetails === 'object' &&
        out.publicMeetingDetails !== null &&
        !Array.isArray(out.publicMeetingDetails)
          ? (out.publicMeetingDetails as Record<string, unknown>)
          : {};
      out.publicMeetingDetails = { ...prev, ...omitNullishRecordEntries(v as Record<string, unknown>) };
      continue;
    }
    if (k === 'nluInference' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const prev =
        typeof out.nluInference === 'object' && out.nluInference !== null && !Array.isArray(out.nluInference)
          ? (out.nluInference as Record<string, unknown>)
          : {};
      out.nluInference = { ...prev, ...omitNullishRecordEntries(v as Record<string, unknown>) };
      continue;
    }
    if (typeof v === 'string' && v.trim() === '' && typeof out[k] === 'string' && String(out[k]).trim() !== '') {
      continue;
    }
    if (Array.isArray(v) && v.length === 0 && Array.isArray(out[k]) && (out[k] as unknown[]).length > 0) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function fingerprintMeetingCreateParsedPlan(plan: {
  categoryId: string;
  title: string;
  minParticipants: number;
  maxParticipants: number;
  autoSchedule: { ymd: string; hm: string };
  placeAutoPickQuery: string | null;
}): string {
  return JSON.stringify({
    c: plan.categoryId,
    t: plan.title,
    min: plan.minParticipants,
    max: plan.maxParticipants,
    ymd: plan.autoSchedule.ymd,
    hm: plan.autoSchedule.hm,
    p: plan.placeAutoPickQuery ?? '',
  });
}
