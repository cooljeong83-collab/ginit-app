import type { Category } from '@/src/lib/categories';
import { categoryNeedsSpecialty, resolveSpecialtyKindForCategory } from '@/src/lib/category-specialty';
import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';

import type { MeetingCreateNluPlan } from '@/src/lib/meeting-create-nlu/types';

/** NLU 검증 결과를 기존 `applyWizardSuggestion` 입력 형태로 변환 */
export function wizardSuggestionFromNluPlan(plan: MeetingCreateNluPlan, categories: Category[]): WizardSuggestion {
  const cat = categories.find((c) => c.id.trim() === plan.categoryId.trim());
  const sk = resolveSpecialtyKindForCategory(cat ?? null);
  const needs = categoryNeedsSpecialty(cat ?? null);
  const canAuto = !needs || (sk === 'food' && Boolean(plan.menuPreferenceLabel));

  return {
    categoryId: plan.categoryId,
    categoryLabel: cat?.label?.trim() ?? plan.categoryLabel,
    menuPreferenceLabel: plan.menuPreferenceLabel,
    canAutoCompleteThroughStep3: canAuto,
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
