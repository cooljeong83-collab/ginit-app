import { useCallback, useEffect, useState } from 'react';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const COUNT_MS = 560;
const PULSE_MS = 140;

export function useAnimatedStatDelta(opts: {
  target: number;
  isGain: boolean;
  animate: boolean;
  delayMs: number;
  reducedMotion: boolean;
}): { displayText: string; pulseScale: ReturnType<typeof useSharedValue<number>> } {
  const { target, isGain, animate, delayMs, reducedMotion } = opts;
  const safeTarget = Math.max(0, Math.trunc(target));
  const progress = useSharedValue(reducedMotion || !animate || safeTarget === 0 ? 1 : 0);
  const pulseScale = useSharedValue(1);
  const initialProgress = reducedMotion || !animate || safeTarget === 0 ? 1 : 0;
  const [displayText, setDisplayText] = useState(() => formatStatDelta(isGain, safeTarget, initialProgress));

  useEffect(() => {
    if (reducedMotion || !animate || safeTarget === 0) {
      progress.value = 1;
      pulseScale.value = 1;
      setDisplayText(formatStatDelta(isGain, safeTarget, 1));
      return;
    }
    progress.value = 0;
    pulseScale.value = 1;
    progress.value = withDelay(
      delayMs,
      withTiming(1, { duration: COUNT_MS }, (finished) => {
        if (finished) {
          pulseScale.value = withSequence(
            withTiming(1.06, { duration: PULSE_MS }),
            withTiming(1, { duration: PULSE_MS }),
          );
        }
      }),
    );
  }, [animate, delayMs, isGain, reducedMotion, safeTarget, progress, pulseScale]);

  const applyDisplayFromProgress = useCallback(
    (progress01: number) => {
      setDisplayText(formatStatDelta(isGain, safeTarget, progress01));
    },
    [isGain, safeTarget],
  );

  useAnimatedReaction(
    () => progress.value,
    (v) => {
      runOnJS(applyDisplayFromProgress)(v);
    },
    [applyDisplayFromProgress],
  );

  return { displayText, pulseScale };
}

function formatStatDelta(isGain: boolean, target: number, progress01: number): string {
  const n = Math.round(Math.max(0, Math.min(1, progress01)) * target);
  return `${isGain ? '+' : '-'}${n}`;
}
