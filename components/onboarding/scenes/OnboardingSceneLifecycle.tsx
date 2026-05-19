import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { ONBOARDING_STAGGER_MS } from '@/components/onboarding/onboarding-motion';
import {
  MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS,
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE,
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL,
} from '@/components/create/meetingCreateFabShared';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { useOnboardingSceneActive } from '@/components/onboarding/scenes/use-onboarding-scene-active';

const NODES = [
  { icon: 'add-circle-outline' as const, label: '생성' },
  { icon: 'people-outline' as const, label: '만남' },
  { icon: 'wallet-outline' as const, label: '정산' },
  { icon: 'star' as const, label: '후기' },
] as const;

type Props = { isActive: boolean; showLogo?: boolean };

export function OnboardingSceneLifecycle({ isActive, showLogo }: Props) {
  const phase = useOnboardingSceneActive(isActive);
  const enter = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      enter.value = 0;
      return;
    }
    enter.value = withDelay(80, withSpring(1, { damping: 14, stiffness: 120 }));
    bob.value = withRepeat(
      withSequence(
        withTiming(1, { duration: MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS }),
        withTiming(0, { duration: MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS }),
      ),
      -1,
      false,
    );
  }, [isActive, enter, bob]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE +
          (bob.value - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL,
      },
      { scale: 0.88 + enter.value * 0.12 },
    ],
    opacity: enter.value,
  }));

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.gradientVeil} pointerEvents="none">
        <LinearGradient
          colors={[...GinitTheme.colors.brandGradient]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
        />
      </View>
      {showLogo ? (
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <View style={styles.logoCard}>
            <Image
              source={require('@/assets/images/logo_symbol.png')}
              style={styles.logoImg}
              contentFit="contain"
            />
          </View>
        </Animated.View>
      ) : null}
      <View style={styles.ring}>
        {NODES.map((node, i) => (
          <NodeChip key={node.label} index={i} node={node} enter={enter} phase={phase} isActive={isActive} />
        ))}
      </View>
    </View>
  );
}

function NodeChip({
  index,
  node,
  enter,
  phase,
  isActive,
}: {
  index: number;
  node: (typeof NODES)[number];
  enter: SharedValue<number>;
  phase: SharedValue<number>;
  isActive: boolean;
}) {
  const angle = (index / NODES.length) * Math.PI * 2 - Math.PI / 2;
  const radius = 88;

  const style = useAnimatedStyle(() => {
    const e = enter.value;
    const pulse = isActive ? 0.92 + phase.value * 0.08 : 1;
    const x = Math.cos(angle) * radius * e;
    const y = Math.sin(angle) * radius * e;
    return {
      opacity: e,
      transform: [{ translateX: x }, { translateY: y }, { scale: pulse }],
    };
  });

  return (
    <Animated.View style={[styles.node, style]}>
      <View style={[ss.glassCard, styles.nodeCard]}>
        <GinitSymbolicIcon name={node.icon} size={22} color={GinitTheme.colors.primary} />
        <Text style={ss.chipText}>{node.label}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  gradientVeil: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.12,
  },
  logoWrap: { position: 'absolute', zIndex: 2 },
  logoCard: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: 42, height: 42 },
  ring: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  node: { position: 'absolute' },
  nodeCard: { alignItems: 'center', gap: 4, minWidth: 56 },
});
