import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { OnboardingLottiePlayer } from '@/components/onboarding/OnboardingLottiePlayer';
import {
  ONBOARDING_SLIDE_OPACITY_ACTIVE,
  ONBOARDING_SLIDE_OPACITY_INACTIVE,
  ONBOARDING_SLIDE_SCALE_ACTIVE,
  ONBOARDING_SLIDE_SCALE_INACTIVE,
  ONBOARDING_USE_LOTTIE_BACKGROUND,
} from '@/components/onboarding/onboarding-motion';
import type { OnboardingSlide } from '@/components/onboarding/onboarding-slides';
import { OnboardingSlideScene } from '@/components/onboarding/scenes/OnboardingSlideScene';
import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  item: OnboardingSlide;
  index: number;
  scrollX: SharedValue<number>;
  screenWidth: number;
  slideHeight: number;
  activePage: number;
  reduceMotion: boolean;
};

export function OnboardingSlidePage({
  item,
  index,
  scrollX,
  screenWidth,
  slideHeight,
  activePage,
  reduceMotion,
}: Props) {
  const isActive = activePage === index;

  const containerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollX.value,
      [(index - 1) * screenWidth, index * screenWidth, (index + 1) * screenWidth],
      [ONBOARDING_SLIDE_OPACITY_INACTIVE, ONBOARDING_SLIDE_OPACITY_ACTIVE, ONBOARDING_SLIDE_OPACITY_INACTIVE],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      scrollX.value,
      [(index - 1) * screenWidth, index * screenWidth, (index + 1) * screenWidth],
      [ONBOARDING_SLIDE_SCALE_INACTIVE, ONBOARDING_SLIDE_SCALE_ACTIVE, ONBOARDING_SLIDE_SCALE_INACTIVE],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  return (
    <Animated.View
      style={[styles.slide, { width: screenWidth, minHeight: slideHeight }, containerStyle]}
      accessibilityLabel={item.accessibilitySummary}>
      <View style={styles.heroStack}>
        {ONBOARDING_USE_LOTTIE_BACKGROUND && item.lottieAsset != null ? (
          <OnboardingLottiePlayer
            lottieAsset={item.lottieAsset}
            isActive={isActive}
            reduceMotion={reduceMotion}
            loop={item.sceneKind === 'connect'}
          />
        ) : null}
        <OnboardingSlideScene
          sceneKind={item.sceneKind}
          isActive={isActive}
          showLogo={item.showLogo}
        />
      </View>
      {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slide: {
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  heroStack: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: 0.2,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    textAlign: 'center',
    letterSpacing: -0.55,
    paddingHorizontal: 8,
  },
  body: {
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
    lineHeight: 23,
    maxWidth: 320,
  },
});
