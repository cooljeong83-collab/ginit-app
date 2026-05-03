import type { AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

const GENERIC_MEETING_LABEL = '모임';

function isUsefulPatternLabel(raw: string | null | undefined): boolean {
  const t = raw?.trim();
  if (!t) return false;
  if (t === GENERIC_MEETING_LABEL) return false;
  return true;
}

function pickUsefulTopPair(sum: AgentWelcomeSnapshot['recentSummary']): { top: string; second: string | null } | null {
  const labels = (sum?.topCategoryLabels ?? [])
    .map((x) => x.trim())
    .filter(isUsefulPatternLabel);
  if (labels.length === 0) return null;
  const top = labels[0];
  const second = labels.length > 1 && labels[1] !== top ? labels[1] : null;
  return { top, second };
}

/**
 * `/create/details` 첫 말풍선 — 환영 인사 없이 패턴·제안만.
 */
export function buildDetailsPatternSuggestMessage(s: AgentWelcomeSnapshot): string {
  const sum = s.recentSummary;
  const pair = pickUsefulTopPair(sum);
  const dna = s.gDnaChips.slice(0, 2).join('·');
  const dnaBit = dna ? ` 성향 ${dna} 느낌이라` : '';

  if (pair) {
    const secondBit = pair.second ? `, ${pair.second}도 자주 썼고` : '';
    return `기록 보면 ${pair.top}${secondBit}${dnaBit} 오늘도 그 라인으로 갈래? ✨ 수락 누르면 바로 맞춰 줄게 🙌`;
  }

  const feedN = sum?.meetingCountSample ?? s.recentMeetings.length;
  const lastTitle = sum?.lastTitle?.trim();
  const usefulLast =
    lastTitle && lastTitle !== GENERIC_MEETING_LABEL ? lastTitle : null;

  if (feedN > 0 && usefulLast) {
    return `최근 ${usefulLast} 기억나${dnaBit} ✨ 오늘도 비슷한 무드로 갈래? 수락 누르면 맞춰 줄게 🙌`;
  }

  if (feedN > 0) {
    return `이미 모임 꽤 돌려왔네${dnaBit} ✨ 이번엔 추천 카테고리로 바로 깔아볼래? 수락 누르면 세팅해 줄게 🙌`;
  }

  const profileN = s.profileMeetingCount;
  /** `meeting_count` 미동기·미세팅(null)이면 첫 모임 멘트로 오인하지 않음 */
  const strictFirstTimer = typeof profileN === 'number' && profileN === 0;

  if (strictFirstTimer) {
    return `첫 모임 각이면 일단 분위기부터 잡아보자 ✨ 수락 누르면 추천 카테고리로 세팅해 줄게 🙌`;
  }

  if (typeof profileN === 'number' && profileN > 0) {
    return `활동 기록은 있는데 목록은 아직 비어 보여${dnaBit} ✨ 수락 누르면 추천 카테고리로 바로 잡아줄게 🙌`;
  }

  return `모임 패턴은 아직 수집 중이야${dnaBit} ✨ 수락 누르면 추천으로 세팅해 볼래? 🙌`;
}
