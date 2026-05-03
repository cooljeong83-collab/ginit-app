import { useLayoutEffect, type MutableRefObject } from 'react';

import { useCreateMeetingAgenticAi } from '@/components/create/CreateMeetingAgenticAiContext';

export type MeetingCreateAgenticSurfaceHandles = {
  setIntelligentSuggestionDirect: (t: string | null) => void;
  setShowAcceptButton: (v: boolean) => void;
  registerAcceptSuggestion: (fn: (() => void) | null) => void;
  setAgentOwnsWizardBubble: (v: boolean) => void;
};

/**
 * `CreateMeetingAgenticAiProvider` 안에서만 동작합니다.
 * Provider 바깥(동일 화면의 상위 state)에서 말풍선·수락 버튼을 제어할 수 있도록 ref에 핸들을 심습니다.
 */
export function CreateMeetingAgenticSurfaceBinder({
  handlesRef,
}: {
  handlesRef: MutableRefObject<MeetingCreateAgenticSurfaceHandles | null>;
}) {
  const {
    setIntelligentSuggestionDirect,
    setShowAcceptButton,
    registerAcceptSuggestion,
    setAgentOwnsWizardBubble,
  } = useCreateMeetingAgenticAi();

  useLayoutEffect(() => {
    handlesRef.current = {
      setIntelligentSuggestionDirect,
      setShowAcceptButton,
      registerAcceptSuggestion,
      setAgentOwnsWizardBubble,
    };
    return () => {
      handlesRef.current = null;
    };
  }, [
    handlesRef,
    setIntelligentSuggestionDirect,
    setShowAcceptButton,
    registerAcceptSuggestion,
    setAgentOwnsWizardBubble,
  ]);

  return null;
}
