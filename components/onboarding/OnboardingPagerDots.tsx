import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import {
  ONBOARDING_DOT_ACTIVE_W,
  ONBOARDING_DOT_H,
  ONBOARDING_DOT_IDLE_W,
  ONBOARDING_SPRING_DOT,
} from '@/components/onboarding/onboarding-motion';
import { ONBOARDING_SLIDES } from '@/components/onboarding/onboarding-slides';
import { GinitTheme } from '@/constants/ginit-theme';

type Props = {
  activePage: number;
};

export function OnboardingPagerDots({ activePage }: Props) {
  return (
    <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel="온보딩 페이지">
      {ONBOARDING_SLIDES.map((s, i) => (
        <Dot key={s.id} active={i === activePage} index={i} />
      ))}
    </View>
  );
}

function Dot({ active, index }: { active: boolean; index: number }) {
  const width = useSharedValue(active ? ONBOARDING_DOT_ACTIVE_W : ONBOARDING_DOT_IDLE_W);

  useEffect(() => {
    width.value = withSpring(
      active ? ONBOARDING_DOT_ACTIVE_W : ONBOARDING_DOT_IDLE_W,
      ONBOARDING_SPRING_DOT,
    );
  }, [active, width]);

  const style = useAnimatedStyle(() => ({
    width: width.value,
    backgroundColor: active ? GinitTheme.colors.primary : 'rgba(148, 163, 184, 0.45)',
  }));

  return (
    <Animated.View
      style={[styles.dot, style]}
      accessibilityLabel={`${index + 1}번째 슬라이드${active ? ', 현재' : ''}`}
    />
  );
}

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    height: ONBOARDING_DOT_H,
    borderRadius: ONBOARDING_DOT_H / 2,
  },
});
