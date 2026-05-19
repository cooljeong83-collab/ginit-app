import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import {
  CREATE_MEETING_AGENT_TYPING_INTERVAL_MS,
  MEETING_CREATE_FAB_GRADIENT_COLORS,
  MEETING_CREATE_FAB_LOGO,
} from '@/components/create/meetingCreateFabShared';
import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useOnboardingSceneActive } from '@/components/onboarding/scenes/use-onboarding-scene-active';

const DEMO_LINE = '내일 저녁 강남역 4인 러닝 모임';
const FIELDS = ['모임 이름', '일정', '장소'] as const;

type Props = { isActive: boolean };

export function OnboardingSceneAgent({ isActive }: Props) {
  const phase = useOnboardingSceneActive(isActive);
  const bob = useSharedValue(0);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!isActive) {
      setTyped('');
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })),
      -1,
      false,
    );
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(DEMO_LINE.slice(0, i));
      if (i >= DEMO_LINE.length) clearInterval(id);
    }, CREATE_MEETING_AGENT_TYPING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isActive, bob]);

  const fabStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -4 + phase.value * 8 }],
  }));

  if (!isActive) {
    return <View style={ss.hero} />;
  }

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View entering={FadeIn.duration(320)} style={styles.bubble}>
        <Text style={styles.bubbleText}>{typed || ' '}</Text>
        <View style={styles.caret} />
      </Animated.View>
      <View style={styles.fields}>
        {FIELDS.map((label, idx) => (
          <Animated.View
            key={label}
            entering={FadeInDown.delay(200 + idx * 120).duration(280)}
            style={[ss.glassCard, styles.fieldRow]}>
            <Text style={ss.label}>{label}</Text>
            <Text style={ss.accent} numberOfLines={1}>
              {idx === 0 ? '강남 러닝 크루' : idx === 1 ? '내일 19:00' : '강남역'}
            </Text>
          </Animated.View>
        ))}
      </View>
      <Animated.View style={[styles.fabWrap, fabStyle]}>
        <LinearGradient colors={MEETING_CREATE_FAB_GRADIENT_COLORS} style={styles.fab}>
          <Image source={MEETING_CREATE_FAB_LOGO} style={styles.fabLogo} contentFit="contain" />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'stretch',
    marginHorizontal: 8,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: GinitTheme.colors.noticeSurface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    minHeight: 44,
  },
  bubbleText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    lineHeight: 18,
  },
  caret: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    width: 2,
    height: 14,
    backgroundColor: GinitTheme.colors.primary,
    borderRadius: 1,
  },
  fields: { gap: 8, alignSelf: 'stretch', paddingHorizontal: 4 },
  fieldRow: { gap: 2 },
  fabWrap: { position: 'absolute', right: 4, bottom: 4 },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLogo: { width: 26, height: 26 },
});
