import { useEffect, useRef, type RefObject } from 'react';

import { useCreateMeetingAgenticAi } from '@/components/create/CreateMeetingAgenticAiContext';
import { buildStepCoachMessage } from '@/src/lib/agentic-guide/build-step-coach-message';
import { buildWizardSuggestion } from '@/src/lib/agentic-guide/build-wizard-suggestion';
import type { Category } from '@/src/lib/categories';
import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';
import { summarizeFrequentPlaceNames } from '@/src/lib/agentic-guide/summarize-frequent-place-names';

export type CreateMeetingWizardAgentBridgeProps = {
  currentStep: number;
  scheduleStep: number;
  placesStep: number;
  detailStep: number;
  seedDate: string;
  seedTime: string;
  categories: Category[];
  applyWizardSuggestion: (s: WizardSuggestion) => void;
  placesFormRef: RefObject<null | { setPlaceQueryFromAgent?: (q: string) => void }>;
};

/**
 * 위저드 단계에 맞춰 에이전트 말풍선·수락 핸들러를 갱신합니다.
 */
export function CreateMeetingWizardAgentBridge({
  currentStep,
  scheduleStep,
  placesStep,
  detailStep,
  seedDate,
  seedTime,
  categories,
  applyWizardSuggestion,
  placesFormRef,
}: CreateMeetingWizardAgentBridgeProps) {
  const {
    agentSnapshot,
    hydrationStatus,
    setCoachPhase,
    setIntelligentSuggestionDirect,
    setShowAcceptButton,
    registerAcceptSuggestion,
    registerSecondaryAction,
  } = useCreateMeetingAgenticAi();

  const snapRef = useRef(agentSnapshot);
  const catRef = useRef(categories);
  snapRef.current = agentSnapshot;
  catRef.current = categories;

  useEffect(() => {
    if (hydrationStatus !== 'ready' || !agentSnapshot) return;

    if (currentStep === 1) {
      setCoachPhase('details_pattern_suggest');
      const sugg = buildWizardSuggestion(categories, agentSnapshot);
      registerAcceptSuggestion(() => {
        const s = buildWizardSuggestion(catRef.current, snapRef.current!);
        if (s) applyWizardSuggestion(s);
      });
      setShowAcceptButton(Boolean(sugg));
      registerSecondaryAction(null, null);
      return;
    }

    if (currentStep === 2) {
      setCoachPhase('details_pattern_suggest');
      setIntelligentSuggestionDirect('세부만 골라주면 바로 다음으로 갈 수 있어 ✨');
      setShowAcceptButton(false);
      registerAcceptSuggestion(null);
      registerSecondaryAction(null, null);
      return;
    }

    if (currentStep === 3) {
      setCoachPhase('details_step3_capacity');
      setIntelligentSuggestionDirect(
        buildStepCoachMessage({
          phase: 'details_step3_capacity',
          snapshot: agentSnapshot,
        }),
      );
      setShowAcceptButton(false);
      registerAcceptSuggestion(null);
      registerSecondaryAction(null, null);
      return;
    }

    if (currentStep === scheduleStep) {
      setCoachPhase('details_step4_schedule');
      const firstScheduleSummary = `${seedDate} ${seedTime}`;
      setIntelligentSuggestionDirect(
        buildStepCoachMessage({
          phase: 'details_step4_schedule',
          snapshot: agentSnapshot,
          firstScheduleSummary,
        }),
      );
      setShowAcceptButton(false);
      registerAcceptSuggestion(null);
      registerSecondaryAction(null, null);
      return;
    }

    if (currentStep === placesStep) {
      setCoachPhase('details_step5_place_suggest');
      const freq = summarizeFrequentPlaceNames(agentSnapshot.recentMeetings);
      const msg = buildStepCoachMessage({
        phase: 'details_step5_place_suggest',
        snapshot: agentSnapshot,
        frequentPlace: freq ?? undefined,
      });
      setIntelligentSuggestionDirect(msg);
      if (freq?.searchQuery) {
        const q = freq.searchQuery;
        setShowAcceptButton(true);
        registerAcceptSuggestion(() => {
          placesFormRef.current?.setPlaceQueryFromAgent?.(q);
          setShowAcceptButton(false);
        });
      } else {
        setShowAcceptButton(false);
        registerAcceptSuggestion(null);
      }
      registerSecondaryAction(null, null);
      return;
    }

    if (currentStep === detailStep) {
      setCoachPhase('details_step6_optional');
      setIntelligentSuggestionDirect(
        buildStepCoachMessage({
          phase: 'details_step6_optional',
          snapshot: agentSnapshot,
        }),
      );
      setShowAcceptButton(false);
      registerAcceptSuggestion(null);
      registerSecondaryAction(null, null);
    }
  }, [
    agentSnapshot,
    applyWizardSuggestion,
    categories,
    currentStep,
    detailStep,
    hydrationStatus,
    placesFormRef,
    placesStep,
    registerAcceptSuggestion,
    registerSecondaryAction,
    scheduleStep,
    seedDate,
    seedTime,
    setCoachPhase,
    setIntelligentSuggestionDirect,
    setShowAcceptButton,
  ]);

  useEffect(() => {
    return () => {
      registerAcceptSuggestion(null);
      registerSecondaryAction(null, null);
    };
  }, [registerAcceptSuggestion, registerSecondaryAction]);

  return null;
}
