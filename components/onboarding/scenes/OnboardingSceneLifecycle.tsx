import { Image } from 'expo-image';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { ONBOARDING_HERO_SIZE } from '@/components/onboarding/onboarding-motion';
import { OnboardingCircleRing } from '@/components/onboarding/scenes/OnboardingCircleRing';
import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

const DEEP_PURPLE = GinitTheme.colors.deepPurple;
const NODE_CIRCLE_SIZE = 76;
/** 도넛 안쪽 구멍 = nodeFace(76px). RN border는 바깥으로만 두꺼워짐 → size = 안쪽 + 2×border */
const NODE_LIT_RING_BORDER = 4;
const NODE_LIT_RING_SIZE = NODE_CIRCLE_SIZE + NODE_LIT_RING_BORDER * 2;
const NODE_LIT_RING_OUTSET = NODE_LIT_RING_BORDER;
const LIT_RING_GLOW = 'rgba(103, 58, 183, 0.55)';
const NODES = [
  { icon: 'add-circle-outline' as const, label: '모임 생성' },
  { icon: 'forum-outline' as const, label: '조율' },
  { icon: 'people-outline' as const, label: '만남' },
  { icon: 'wallet-outline' as const, label: '정산' },
] as const;

const NODE_COUNT = NODES.length;
const RING_RADIUS = 102;
const CENTER = ONBOARDING_HERO_SIZE / 2;
const RING_DRAW_MS = 2200;
const RING_DRAW_DELAY_MS = 450;
const RING_ROTATE_MS = 22_000;
const NODE_LIT_RAMP = 0.09;
const PRIMARY = GinitTheme.colors.primary;

function nodeCenter(index: number): { x: number; y: number } {
  const angle = (index / NODE_COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CENTER + Math.cos(angle) * RING_RADIUS,
    y: CENTER + Math.sin(angle) * RING_RADIUS,
  };
}

function nodeFrame(index: number): { left: number; top: number } {
  const c = nodeCenter(index);
  const half = NODE_CIRCLE_SIZE / 2;
  return { left: c.x - half, top: c.y - half };
}

/** 원 그리기 진행(0→1)에 맞춰 노드 순서대로 점등 (모임 생성→조율→만남→정산). */
function nodeLitAmount(ringDraw: number, index: number): number {
  'worklet';
  const threshold = index / NODE_COUNT;
  return interpolate(ringDraw, [threshold, threshold + NODE_LIT_RAMP], [0, 1], Extrapolation.CLAMP);
}

type Props = { isActive: boolean; showLogo?: boolean };

export function OnboardingSceneLifecycle({ isActive, showLogo }: Props) {
  const enter = useSharedValue(0);
  const logoEnter = useSharedValue(0);
  const ringDraw = useSharedValue(0);
  const ringRotate = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      cancelAnimation(enter);
      cancelAnimation(logoEnter);
      cancelAnimation(ringDraw);
      cancelAnimation(ringRotate);
      enter.value = 0;
      logoEnter.value = 0;
      ringDraw.value = 0;
      ringRotate.value = 0;
      return;
    }

    enter.value = withSpring(1, { damping: 18, stiffness: 88 });
    logoEnter.value = withDelay(60, withSpring(1, { damping: 22, stiffness: 72 }));

    ringDraw.value = withDelay(
      RING_DRAW_DELAY_MS,
      withTiming(1, { duration: RING_DRAW_MS, easing: Easing.linear }),
    );

    const rotateStartMs = RING_DRAW_DELAY_MS + RING_DRAW_MS + 280;
    ringRotate.value = withDelay(
      rotateStartMs,
      withRepeat(withTiming(2 * Math.PI, { duration: RING_ROTATE_MS, easing: Easing.linear }), -1, false),
    );
  }, [isActive, enter, logoEnter, ringDraw, ringRotate]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoEnter.value,
    transform: [{ scale: 0.92 + logoEnter.value * 0.08 }],
  }));

  const ringLayerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${ringRotate.value}rad` }],
  }));

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.ringLayer, ringLayerStyle]} pointerEvents="none">
        <OnboardingCircleRing
          cx={CENTER}
          cy={CENTER}
          radius={RING_RADIUS}
          progress={ringDraw}
          color="rgba(69, 39, 160, 0.32)"
          strokeWidth={1.5}
        />
      </Animated.View>

      <View style={styles.nodesLayer} pointerEvents="none">
        {NODES.map((node, index) => (
          <NodeChip key={node.label} index={index} node={node} enter={enter} ringDraw={ringDraw} />
        ))}
      </View>

      {showLogo ? (
        <Animated.View style={[styles.logoWrap, logoStyle]} pointerEvents="none">
          <View style={styles.logoCard}>
            <Image
              source={require('@/assets/images/logo_symbol_removed_bg_white.png')}
              style={styles.logoImg}
              contentFit="contain"
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function NodeChip({
  index,
  node,
  enter,
  ringDraw,
}: {
  index: number;
  node: (typeof NODES)[number];
  enter: SharedValue<number>;
  ringDraw: SharedValue<number>;
}) {
  const frame = nodeFrame(index);

  const style = useAnimatedStyle(() => {
    const e = enter.value;
    const lit = nodeLitAmount(ringDraw.value, index);
    return {
      opacity: e,
      transform: [{ scale: 0.88 + e * 0.12 + lit * 0.05 }],
    };
  });

  const litRingStyle = useAnimatedStyle(() => {
    const e = enter.value;
    const lit = nodeLitAmount(ringDraw.value, index);
    if (lit < 0.01) {
      return { opacity: 0, borderWidth: 0 };
    }
    return {
      opacity: e * lit * 0.62,
      borderWidth: NODE_LIT_RING_BORDER,
      borderColor: interpolateColor(lit, [0, 1], ['rgba(103, 58, 183, 0)', LIT_RING_GLOW]),
      transform: [{ scale: 0.92 + lit * 0.14 }],
    };
  });

  const circleStyle = useAnimatedStyle(() => {
    const lit = nodeLitAmount(ringDraw.value, index);
    return {
      borderColor: interpolateColor(lit, [0, 1], ['rgba(69, 39, 160, 0.22)', 'rgba(69, 39, 160, 0.35)']),
      backgroundColor: '#FFFFFF',
    };
  });

  const iconStyle = useAnimatedStyle(() => {
    const lit = nodeLitAmount(ringDraw.value, index);
    return { opacity: 0.72 + lit * 0.28 };
  });

  const labelStyle = useAnimatedStyle(() => {
    const lit = nodeLitAmount(ringDraw.value, index);
    return {
      color: interpolateColor(lit, [0, 1], ['rgba(69, 39, 160, 0.75)', PRIMARY]),
    };
  });

  return (
    <Animated.View style={[styles.node, frame, style]}>
      <Animated.View style={[styles.litRing, litRingStyle]} pointerEvents="none" />
      <Animated.View style={[styles.nodeFace, circleStyle]}>
        <Animated.View style={iconStyle}>
          <GinitSymbolicIcon name={node.icon} size={24} color={PRIMARY} />
        </Animated.View>
        <Animated.Text style={[styles.nodeLabelInside, labelStyle]} numberOfLines={2}>
          {node.label}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    position: 'absolute',
    left: CENTER - 32,
    top: CENTER - 32,
    zIndex: 30,
    ...(Platform.OS === 'android' ? { elevation: 12 } : null),
  },
  logoCard: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DEEP_PURPLE,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    borderWidth: 1,
  },
  logoImg: { width: 42, height: 42 },
  ringLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
    ...(Platform.OS === 'android' ? { elevation: 0 } : null),
  },
  nodesLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  node: {
    position: 'absolute',
    width: NODE_CIRCLE_SIZE,
    height: NODE_CIRCLE_SIZE,
    overflow: 'visible',
    zIndex: 20,
  },
  litRing: {
    position: 'absolute',
    width: NODE_LIT_RING_SIZE,
    height: NODE_LIT_RING_SIZE,
    left: -NODE_LIT_RING_OUTSET,
    top: -NODE_LIT_RING_OUTSET,
    borderRadius: NODE_LIT_RING_SIZE / 2,
    backgroundColor: 'transparent',
    borderWidth: 0,
    zIndex: 0,
  },
  nodeFace: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: NODE_CIRCLE_SIZE,
    height: NODE_CIRCLE_SIZE,
    borderRadius: NODE_CIRCLE_SIZE / 2,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(69, 39, 160, 0.22)',
    zIndex: 10,
  },
  nodeLabelInside: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    textAlign: 'center',
  },
});
