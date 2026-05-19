import { useEffect } from 'react';
import {
  cancelAnimation,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/** 슬라이드가 활성일 때만 루프 애니를 돌립니다. */
export function useOnboardingSceneActive(isActive: boolean) {
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = withRepeat(
      withSequence(withTiming(1, { duration: 1400 }), withTiming(0, { duration: 1400 })),
      -1,
      false,
    );
    return () => {
      cancelAnimation(phase);
    };
  }, [isActive, phase]);

  return phase;
}
