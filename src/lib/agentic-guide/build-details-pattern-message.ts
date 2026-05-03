import type { AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';

/**
 * `/create/details` 첫 말풍선 — 환영 인사 없이 패턴·제안만.
 */
export function buildDetailsPatternSuggestMessage(s: AgentWelcomeSnapshot): string {
  const sum = s.recentSummary;
  const top = sum?.topCategoryLabels?.[0]?.trim();
  const second = sum?.topCategoryLabels?.[1]?.trim();
  const dna = s.gDnaChips.slice(0, 2).join('·');
  const dnaBit = dna ? ` 성향 ${dna} 느낌이라` : '';

  if (top) {
    const pair = second && second !== top ? `, ${second}도 자주 썼고` : '';
    return `기록 보면 ${top}${pair}${dnaBit} 오늘도 그 라인으로 갈래? ✨ 수락 누르면 바로 맞춰 줄게 🙌`;
  }
  if ((s.profileMeetingCount ?? 0) === 0) {
    return `첫 모임 각이면 일단 분위기부터 잡아보자 ✨ 수락 누르면 추천 카테고리로 세팅해 줄게 🙌`;
  }
  return `모임 패턴은 아직 수집 중이야${dnaBit} ✨ 수락 누르면 추천으로 세팅해 볼래? 🙌`;
}
