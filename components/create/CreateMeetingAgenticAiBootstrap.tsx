import { useEffect, useRef } from 'react';

import {
  buildMzAgentMessage,
  buildVirtualWeatherForSlot,
  pickTimeSlot,
  useCreateMeetingAgenticAi,
} from '@/components/create/CreateMeetingAgenticAiContext';
import { buildStep1FrequentPatternOfferMessage } from '@/src/lib/agentic-guide/build-details-pattern-message';
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
        setIntelligentSuggestionDirect(buildStep1FrequentPatternOfferMessage(snap));
        setHydrationStatus('ready');
        setShowAcceptButton(true);
      } catch {
        if (cancelled) return;
        const slot = pickTimeSlot();
        const vw = buildVirtualWeatherForSlot(slot);
        setHydrationStatus('error');
        setIntelligentSuggestionDirect(
          buildMzAgentMessage({
            timeSlot: slot,
            weatherMood: vw.weatherMood,
            temperatureC: vw.temperatureC,
            locationHint: null,
            displayName: null,
            intelligentSuggestion: null,
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
