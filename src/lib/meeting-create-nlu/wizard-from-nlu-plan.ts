import type { Category } from '@/src/lib/categories';
import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';

import type { MeetingCreateNluPlan } from '@/src/lib/meeting-create-nlu/types';

/** NLU 검증 결과를 기존 `applyWizardSuggestion` 입력 형태로 변환 */
export function wizardSuggestionFromNluPlan(plan: MeetingCreateNluPlan, categories: Category[]): WizardSuggestion {
  const cat = categories.find((c) => c.id.trim() === plan.categoryId.trim());

  return {
    categoryId: plan.categoryId,
    categoryLabel: cat?.label?.trim() ?? plan.categoryLabel,
    menuPreferenceLabel: plan.menuPreferenceLabel,
    movieTitleHints: plan.movieTitleHints.length > 0 ? plan.movieTitleHints : undefined,
    activityKindLabel: plan.activityKindLabel,
    gameKindLabel: plan.gameKindLabel,
    pcGameKindLabel: plan.pcGameKindLabel,
    focusKnowledgeLabel: plan.focusKnowledgeLabel,
    canAutoCompleteThroughStep3: plan.canAutoCompleteThroughStep3,
    placeSearchHint: plan.placeAutoPickQuery,
    placeAutoPickQuery: plan.placeAutoPickQuery,
    publicMeetingDetailsPartial: plan.publicMeetingDetailsPartial,
    suggestedIsPublic: plan.suggestedIsPublic,
    autoBasicInfo: {
      title: plan.title,
      avgMinParticipants: plan.minParticipants,
      avgMaxParticipants: plan.maxParticipants,
    },
    autoSchedule: plan.autoSchedule,
  };
}
