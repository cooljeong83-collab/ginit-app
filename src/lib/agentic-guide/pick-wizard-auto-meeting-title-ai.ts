import type { Category } from '@/src/lib/categories';
import { pickAutoMeetingTitleFromSnapshot } from '@/src/lib/agentic-guide/compute-history-participant-bands';
import { buildWizardTitleSuggestionContextFromSnapshot } from '@/src/lib/agentic-guide/build-wizard-title-suggestion-context';
import type { AgentWelcomeSnapshot } from '@/src/lib/agentic-guide/types';
import { generateSuggestedMeetingTitles } from '@/src/lib/meeting-title-suggestion';

function pickIndexDeterministic(s: AgentWelcomeSnapshot, cat: Category, len: number): number {
  if (len <= 0) return 0;
  const mix =
    cat.id.length * 7919 +
    (cat.label?.length ?? 0) * 131 +
    s.now.getFullYear() * 3 +
    s.now.getMonth() * 17 +
    s.now.getDate() * 5 +
    s.now.getHours() * 23 +
    (s.recentMeetings?.length ?? 0) * 997;
  return ((mix % len) + len) % len;
}

/**
 * FAB 자동 적용 시 모임 이름 — `generateSuggestedMeetingTitles`로 만든 AI 추천 후보 중 하나를 선택합니다.
 * 후보가 없으면 기존 스냅샷 기반 폴백(`pickAutoMeetingTitleFromSnapshot`)을 씁니다.
 */
export function pickWizardAutoMeetingTitleFromAiSuggestions(
  s: AgentWelcomeSnapshot,
  cat: Category,
  menuPreferenceLabel: string | null,
): string {
  const ctx = buildWizardTitleSuggestionContextFromSnapshot(s, cat, { menuPreferenceLabel });
  const label = cat.label.trim() || '모임';
  const titles = generateSuggestedMeetingTitles(label, s.now, 5, ctx);
  if (titles.length === 0) {
    return pickAutoMeetingTitleFromSnapshot(s, cat.label);
  }
  return titles[pickIndexDeterministic(s, cat, titles.length)]!;
}
