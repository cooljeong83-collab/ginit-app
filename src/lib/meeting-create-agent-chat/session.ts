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

/** 첫 턴 인사만으로 보일 때(모델 없이 빠른 응답 가능) */
export function isLikelyMeetingCreateGreetingOnly(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length > 48) return false;
  const greeting =
    /^(안녕|하이|헬로|hello|hi|반가|좋은\s*(아침|점심|저녁|밤)|굿\s*(모닝|이브닝)|잘\s*지내|오랜만)/.test(t);
  const thin = t.length <= 18 && /^[가-힣\s,.!?~]+$/.test(t);
  return greeting || (thin && !/[모임일정장소인원카테고리]/.test(t));
}

/**
 * Edge/클라이언트 공용: null/undefined 패치 값은 기존 누적을 덮지 않음.
 * `인원`·`publicMeetingDetails`는 얕은 병합.
 */
export function mergeMeetingCreateNluAccumulated(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k === '인원' && typeof v === 'object' && !Array.isArray(v)) {
      const prev =
        typeof out['인원'] === 'object' && out['인원'] !== null && !Array.isArray(out['인원'])
          ? (out['인원'] as Record<string, unknown>)
          : {};
      out['인원'] = { ...prev, ...(v as Record<string, unknown>) };
      continue;
    }
    if (k === 'publicMeetingDetails' && typeof v === 'object' && !Array.isArray(v)) {
      const prev =
        typeof out.publicMeetingDetails === 'object' &&
        out.publicMeetingDetails !== null &&
        !Array.isArray(out.publicMeetingDetails)
          ? (out.publicMeetingDetails as Record<string, unknown>)
          : {};
      out.publicMeetingDetails = { ...prev, ...(v as Record<string, unknown>) };
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
