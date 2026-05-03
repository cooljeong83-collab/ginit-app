import type { Meeting } from '@/src/lib/meetings';
import { MEETING_CAPACITY_UNLIMITED, MEETING_PARTICIPANT_MIN } from '@/src/lib/meetings';

import type { AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

function normalizeMajorCode(mc: string | null | undefined): string | null {
  const t = (mc ?? '').trim();
  return t.length === 0 ? null : t.toLowerCase();
}

/**
 * 참여·피드 모임에서 최소·최대 정원의 산술 평균(반올림).
 * 공개 모임의 무제한(999) 정원은 최소값으로 대체해 평균 왜곡을 줄입니다.
 */
export function computeHistoryParticipantAverages(meetings: Meeting[]): { avgMin: number; avgMax: number } | null {
  if (!meetings?.length) return null;
  const mins: number[] = [];
  const maxs: number[] = [];
  for (const m of meetings) {
    const minP =
      typeof m.minParticipants === 'number' && Number.isFinite(m.minParticipants)
        ? Math.trunc(m.minParticipants)
        : null;
    const cap = typeof m.capacity === 'number' && Number.isFinite(m.capacity) ? Math.trunc(m.capacity) : null;
    const minV = minP ?? cap;
    if (minV == null || minV < MEETING_PARTICIPANT_MIN) continue;
    mins.push(minV);
    const rawMax = cap ?? minV;
    const maxV =
      rawMax === MEETING_CAPACITY_UNLIMITED ? minV : Math.max(rawMax, minV);
    if (maxV >= MEETING_PARTICIPANT_MIN) maxs.push(maxV);
  }
  if (mins.length === 0) return null;
  const avgMin = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
  const avgMaxSrc = maxs.length ? maxs : mins;
  const avgMaxRaw = Math.round(avgMaxSrc.reduce((a, b) => a + b, 0) / avgMaxSrc.length);
  const avgMax = Math.max(avgMaxRaw, avgMin);
  return { avgMin, avgMax };
}

/**
 * 선택된 모임 성격과 동일한 `meeting_categories.major_code`인 모임만 모아 평균 인원을 계산합니다.
 * `categoryId` → `majorCode` 매핑은 앱 카테고리 목록으로 합니다.
 * 선택 카테고리에 `majorCode`가 없으면 전체 모임으로 평균(기존과 동일)합니다.
 */
export function computeHistoryParticipantAveragesForSelectedMajor(
  meetings: Meeting[],
  categoryIdToMajorCode: ReadonlyMap<string, string | null | undefined>,
  selectedMajorCode: string | null | undefined,
): { avgMin: number; avgMax: number } | null {
  const targetNorm = normalizeMajorCode(selectedMajorCode);
  const pool =
    targetNorm == null
      ? meetings
      : meetings.filter((m) => {
          const cid = (m.categoryId ?? '').trim();
          if (!cid) return false;
          const mcRaw = categoryIdToMajorCode.get(cid);
          return normalizeMajorCode(mcRaw ?? null) === targetNorm;
        });
  return computeHistoryParticipantAverages(pool);
}

/** 자동 제목: 최근 의미 있는 제목이 있으면 사용, 없으면 카테고리 기반 한 줄 */
export function pickAutoMeetingTitleFromSnapshot(s: AgentWelcomeSnapshot, categoryLabel: string): string {
  const last = s.recentSummary?.lastTitle?.trim();
  if (last && last !== '모임') return last;
  const lab = categoryLabel.trim() || '모임';
  return `${lab} 모임`;
}
