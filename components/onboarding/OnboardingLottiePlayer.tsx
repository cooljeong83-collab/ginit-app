import LottieView, { type AnimationObject } from 'lottie-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { ONBOARDING_HERO_SIZE } from '@/components/onboarding/onboarding-motion';

type Props = {
  lottieAsset: number;
  isActive: boolean;
  reduceMotion: boolean;
  loop?: boolean;
};

export function OnboardingLottiePlayer({
  lottieAsset,
  isActive,
  reduceMotion,
  loop = false,
}: Props) {
  const ref = useRef<LottieView>(null);

  useEffect(() => {
    if (reduceMotion) {
      ref.current?.pause();
      return;
    }
    if (isActive) {
      ref.current?.play();
    } else {
      ref.current?.pause();
      ref.current?.reset();
    }
  }, [isActive, reduceMotion]);

  if (reduceMotion) {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="none">
      <LottieView
        ref={ref}
        source={lottieAsset as unknown as AnimationObject}
        style={styles.lottie}
        autoPlay={false}
        loop={loop}
        renderMode="AUTOMATIC"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  lottie: {
    width: ONBOARDING_HERO_SIZE,
    height: ONBOARDING_HERO_SIZE,
  },
});
