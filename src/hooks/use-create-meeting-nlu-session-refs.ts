import { useCallback, useRef, useState } from 'react';

import type { WizardSuggestion } from '@/src/lib/agentic-guide/types';
import { createEmptyMeetingCreateAgentChatSession } from '@/src/lib/meeting-create-agent-chat/session';

export type MeetingCreateNluConfirmPhase = 'none' | 'summary' | 'which_part' | 'applying';

/**
 * 모임 생성 화면 NLU 멀티턴 — ref·확인 페이즈 state만 묶음 (`CreateDetailsScreen` 본문 축소).
 */
export function useCreateMeetingNluSessionRefs() {
  const agentNluAccumulatedRef = useRef<Record<string, unknown>>({});
  const pendingNluBoxOfficeTopThreeRef = useRef<{ title: string }[] | null>(null);
  const agentNluSessionRef = useRef(createEmptyMeetingCreateAgentChatSession());
  const agentNluLastFingerprintRef = useRef<string | null>(null);
  const meetingCreateNluOpeningUtteranceRef = useRef('');
  const pendingNluWizardApplyRef = useRef<{ fp: string; sugg: WizardSuggestion } | null>(null);
  const pendingNluSummaryConfirmMsgRef = useRef('');
  const meetingCreateNluConfirmPhaseRef = useRef<MeetingCreateNluConfirmPhase>('none');
  const [meetingCreateNluBlocksFloatingFinal, setMeetingCreateNluBlocksFloatingFinal] = useState(false);

  const setMeetingCreateNluConfirmPhase = useCallback((next: MeetingCreateNluConfirmPhase) => {
    meetingCreateNluConfirmPhaseRef.current = next;
    setMeetingCreateNluBlocksFloatingFinal(next !== 'none');
  }, []);

  return {
    agentNluAccumulatedRef,
    pendingNluBoxOfficeTopThreeRef,
    agentNluSessionRef,
    agentNluLastFingerprintRef,
    meetingCreateNluOpeningUtteranceRef,
    pendingNluWizardApplyRef,
    pendingNluSummaryConfirmMsgRef,
    meetingCreateNluConfirmPhaseRef,
    meetingCreateNluBlocksFloatingFinal,
    setMeetingCreateNluConfirmPhase,
  };
}
