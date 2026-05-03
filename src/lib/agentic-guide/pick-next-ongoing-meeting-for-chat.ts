import { getMeetingRecruitmentPhase, type Meeting } from '@/src/lib/meetings';

import type { OngoingMeetingsChatHint } from '@/src/lib/agentic-guide/types';

function parseYmdToUtcMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : null;
}

function meetingSortTimeMs(m: Meeting, now: Date): number {
  const ymd = (m.scheduleDate ?? '').trim();
  const t = ymd ? parseYmdToUtcMs(ymd) : null;
  if (t != null) return t;
  const ca = m.createdAt?.toMillis?.() ?? null;
  if (typeof ca === 'number' && Number.isFinite(ca)) return ca;
  return now.getTime();
}

/** 모집 중·정원·일정상 아직 “진행/예정”으로 보는 모임(과거·종료 피드와 구분용). */
export function isOngoingForChat(m: Meeting, now: Date): boolean {
  const phase = getMeetingRecruitmentPhase(m);
  if (phase === 'recruiting' || phase === 'full') return true;
  const ymd = (m.scheduleDate ?? '').trim();
  const dayMs = parseYmdToUtcMs(ymd);
  if (dayMs != null) {
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    /** 확정이어도 오늘 이후 일정이면 '진행 예정'으로 채팅 유도 대상에 포함 */
    if (dayMs >= startToday - 86400000) return true;
  }
  return false;
}

function chatRouteMeetingId(m: Meeting): string {
  return (m.id ?? '').trim();
}

/**
 * 진행·모집 중 모임 건수와 일정상 가장 가까운 1건(미래 우선, 없으면 가장 최근).
 */
export function pickOngoingMeetingsChatHint(meetings: Meeting[], now: Date = new Date()): OngoingMeetingsChatHint {
  const ongoing = meetings.filter((x) => isOngoingForChat(x, now));
  const n = ongoing.length;
  if (n === 0) return { count: 0, nearestMeetingId: null, nearestTitle: null };

  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const withT = ongoing.map((m) => ({ m, t: meetingSortTimeMs(m, now) }));
  const future = withT.filter((x) => x.t >= startToday - 86400000).sort((a, b) => a.t - b.t);
  const pick = (future[0] ?? withT.sort((a, b) => b.t - a.t)[0])?.m;
  if (!pick) return { count: n, nearestMeetingId: null, nearestTitle: null };

  const id = chatRouteMeetingId(pick);
  const title = (pick.title ?? '').trim() || null;
  return { count: n, nearestMeetingId: id || null, nearestTitle: title };
}
