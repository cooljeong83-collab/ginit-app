import { useEffect, useRef, type RefObject } from 'react';

import { useCreateMeetingAgenticAi } from '@/components/create/CreateMeetingAgenticAiContext';
import { buildStep1FrequentPatternOfferMessage } from '@/src/lib/agentic-guide/build-details-pattern-message';
import { buildStepCoachMessage } from '@/src/lib/agentic-guide/build-step-coach-message';
import { buildStep2SpecialtyCoachMessage } from '@/src/lib/agentic-guide/build-step2-specialty-coach-message';
import { buildWizardSuggestion } from '@/src/lib/agentic-guide/build-wizard-suggestion';
import { isColdStartForAgentSnapshot } from '@/src/lib/agentic-guide/cold-start';
import { summarizeFrequentPlaceNames } from '@/src/lib/agentic-guide/summarize-frequent-place-names';
import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';
import type { Category } from '@/src/lib/categories';

export type CreateMeetingWizardAgentBridgeProps = {
  currentStep: number;
  scheduleStep: number;
  placesStep: number;
  detailStep: number;
  seedDate: string;
  seedTime: string;
  categories: Category[];
  /** Step 2 안내 — `major_code`·특화 카드와 맞추기 위해 1단계에서 선택된 카테고리 id */
  selectedCategoryId: string | null;
  applyWizardSuggestion: (s: WizardSuggestion) => void;
  placesFormRef: RefObject<null | { setPlaceQueryFromAgent?: (q: string) => void }>;
  /** 오토파일럿이 말풍선·수락을 직접 제어하는 동안 브리지가 덮어쓰지 않음 */
  autopilotCoachLocked?: boolean;
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
  selectedCategoryId,
  applyWizardSuggestion,
  placesFormRef,
  autopilotCoachLocked = false,
}: CreateMeetingWizardAgentBridgeProps) {
  const {
    agentSnapshot,
    hydrationStatus,
    setCoachPhase,
    setIntelligentSuggestionDirect,
    setShowAcceptButton,
    registerAcceptSuggestion,
    registerSecondaryAction,
    setWizardAwaitingFinalSubmit,
  } = useCreateMeetingAgenticAi();

  const snapRef = useRef(agentSnapshot);
  const catRef = useRef(categories);
  snapRef.current = agentSnapshot;
  catRef.current = categories;

  useEffect(() => {
    if (hydrationStatus !== 'ready' || !agentSnapshot) {
      setWizardAwaitingFinalSubmit(false);
      return;
    }

    setWizardAwaitingFinalSubmit(currentStep === detailStep);

    if (autopilotCoachLocked) {
      return;
    }

    if (currentStep === 1) {
      setCoachPhase('details_pattern_suggest');
      setIntelligentSuggestionDirect(buildStep1FrequentPatternOfferMessage(agentSnapshot));
      const cold = isColdStartForAgentSnapshot(agentSnapshot);
      const sugg = cold ? null : buildWizardSuggestion(categories, agentSnapshot);
      registerAcceptSuggestion(
        cold
          ? null
          : () => {
              const s = buildWizardSuggestion(catRef.current, snapRef.current!);
              if (s) applyWizardSuggestion(s);
            },
      );
      setShowAcceptButton(Boolean(sugg));
      registerSecondaryAction(null, null);
      return;
    }

    if (currentStep === 2) {
      setCoachPhase('details_pattern_suggest');
      const selectedCat = selectedCategoryId
        ? (categories.find((c) => c.id === selectedCategoryId) ?? null)
        : null;
      setIntelligentSuggestionDirect(
        buildStep2SpecialtyCoachMessage(selectedCat, isColdStartForAgentSnapshot(agentSnapshot)),
      );
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
          meetingHabits: agentSnapshot.meetingHabits ?? undefined,
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
          meetingHabits: agentSnapshot.meetingHabits ?? undefined,
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
      const habitQ = agentSnapshot.meetingHabits?.topPlaces?.[0]?.searchQuery?.trim() ?? '';
      const freqQ = freq?.searchQuery?.trim() ?? '';
      const q = habitQ || freqQ;
      const msg = buildStepCoachMessage({
        phase: 'details_step5_place_suggest',
        snapshot: agentSnapshot,
        frequentPlace: freq ?? undefined,
        meetingHabits: agentSnapshot.meetingHabits ?? undefined,
      });
      setIntelligentSuggestionDirect(msg);
      if (q) {
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
          meetingHabits: agentSnapshot.meetingHabits ?? undefined,
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
    selectedCategoryId,
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
    setWizardAwaitingFinalSubmit,
    detailStep,
    autopilotCoachLocked,
  ]);

  useEffect(() => {
    return () => {
      registerAcceptSuggestion(null);
      registerSecondaryAction(null, null);
    };
  }, [registerAcceptSuggestion, registerSecondaryAction]);

  return null;
}
