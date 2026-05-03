import { useEffect, useRef } from 'react';

import { buildVirtualWeatherForSlot, pickTimeSlot, useCreateMeetingAgenticAi } from '@/components/create/CreateMeetingAgenticAiContext';
import {
  buildStep1ConversationalGreetingFromParts,
  buildStep1ConversationalGreetingMessage,
} from '@/src/lib/agentic-guide/build-step1-conversational-greeting';
import { loadWelcomeSnapshot } from '@/src/lib/agentic-guide/load-welcome-snapshot';
import { useUserSession } from '@/src/context/UserSessionContext';

const THINKING = '생각 중입니다…';

/**
 * `CreateMeetingAgenticAiProvider` **안쪽**에만 마운트합니다.
 */
export function CreateMeetingAgenticAiBootstrap() {
  const { userId } = useUserSession();
  const {
    setInjectedData,
    setHydrationStatus,
    setAgentSnapshot,
    setCoachPhase,
    setShowAcceptButton,
    registerAcceptSuggestion,
    setIntelligentSuggestionDirect,
  } = useCreateMeetingAgenticAi();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    let cancelled = false;

    void (async () => {
      setHydrationStatus('loading');
      setIntelligentSuggestionDirect(THINKING);
      try {
        const snap = await loadWelcomeSnapshot(userId);
        if (cancelled) return;
        setAgentSnapshot(snap);
        setInjectedData({
          timeSlot: snap.timeSlot,
          weatherMood: snap.weatherMood,
          temperatureC: snap.temperatureC,
          locationHint: snap.locationHint,
          displayName: snap.displayName,
          intelligentSuggestion: null,
        });
        setCoachPhase('details_pattern_suggest');
        setIntelligentSuggestionDirect(buildStep1ConversationalGreetingMessage(snap));
        setHydrationStatus('ready');
        setShowAcceptButton(false);
      } catch {
        if (cancelled) return;
        const slot = pickTimeSlot();
        const vw = buildVirtualWeatherForSlot(slot);
        setHydrationStatus('error');
        setIntelligentSuggestionDirect(
          buildStep1ConversationalGreetingFromParts({
            now: new Date(),
            displayName: null,
            locationHint: null,
            weatherMood: vw.weatherMood,
            timeSlot: slot,
          }),
        );
        setShowAcceptButton(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    userId,
    setAgentSnapshot,
    setCoachPhase,
    setHydrationStatus,
    setInjectedData,
    setIntelligentSuggestionDirect,
    setShowAcceptButton,
  ]);

  useEffect(() => {
    return () => {
      registerAcceptSuggestion(null);
    };
  }, [registerAcceptSuggestion]);

  return null;
}
