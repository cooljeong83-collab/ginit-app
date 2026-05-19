import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ONBOARDING_HERO_SIZE } from '@/components/onboarding/onboarding-motion';
import { OnboardingBezierArc } from '@/components/onboarding/scenes/OnboardingBezierArc';
import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { useOnboardingSceneActive } from '@/components/onboarding/scenes/use-onboarding-scene-active';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

const NODES = [
  { icon: 'person-outline' as const, label: '앱', x: 52 },
  { icon: 'map-outline' as const, label: '지도', x: ONBOARDING_HERO_SIZE / 2 },
  { icon: 'chatbubbles-outline' as const, label: '채팅', x: ONBOARDING_HERO_SIZE - 52 },
] as const;

/** 노드 카드 상단 연결점(박스와 겹치지 않게 위쪽) */
const NODE_ANCHOR_Y = 96;
const ARC_LIFT = 68;
const ARC_DRAW_MS = 620;
const ARC2_DELAY_MS = 720;

function nodeAnchor(x: number): { x: number; y: number } {
  return { x, y: NODE_ANCHOR_Y };
}

const ARC_APP_TO_MAP = {
  start: nodeAnchor(NODES[0]!.x),
  control: {
    x: (NODES[0]!.x + NODES[1]!.x) / 2,
    y: NODE_ANCHOR_Y - ARC_LIFT,
  },
  end: nodeAnchor(NODES[1]!.x),
};

const ARC_MAP_TO_CHAT = {
  start: nodeAnchor(NODES[1]!.x),
  control: {
    x: (NODES[1]!.x + NODES[2]!.x) / 2,
    y: NODE_ANCHOR_Y - ARC_LIFT,
  },
  end: nodeAnchor(NODES[2]!.x),
};

type Props = { isActive: boolean };

export function OnboardingSceneConnect({ isActive }: Props) {
  const phase = useOnboardingSceneActive(isActive);
  const arc1 = useSharedValue(0);
  const arc2 = useSharedValue(0);
  const linePulse = useSharedValue(0.5);

  useEffect(() => {
    if (!isActive) {
      cancelAnimation(arc1);
      cancelAnimation(arc2);
      cancelAnimation(linePulse);
      arc1.value = 0;
      arc2.value = 0;
      linePulse.value = 0.5;
      return;
    }

    const ease = Easing.inOut(Easing.quad);
    arc1.value = withDelay(280, withTiming(1, { duration: ARC_DRAW_MS, easing: ease }));
    arc2.value = withDelay(280 + ARC2_DELAY_MS, withTiming(1, { duration: ARC_DRAW_MS, easing: ease }));
    linePulse.value = withDelay(
      280 + ARC2_DELAY_MS + ARC_DRAW_MS,
      withRepeat(withTiming(1, { duration: 1400 }), -1, true),
    );
  }, [isActive, arc1, arc2, linePulse]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: 6 + phase.value * -10 }],
    opacity: 0.7 + phase.value * 0.3,
  }));

  const arcPulseStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + linePulse.value * 0.4,
  }));

  if (!isActive) return <View style={ss.hero} />;

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.arcLayer, arcPulseStyle]} pointerEvents="none">
        <OnboardingBezierArc
          start={ARC_APP_TO_MAP.start}
          control={ARC_APP_TO_MAP.control}
          end={ARC_APP_TO_MAP.end}
          progress={arc1}
          color={GinitTheme.colors.primary}
        />
        <OnboardingBezierArc
          start={ARC_MAP_TO_CHAT.start}
          control={ARC_MAP_TO_CHAT.control}
          end={ARC_MAP_TO_CHAT.end}
          progress={arc2}
          color={GinitTheme.colors.primary}
        />
      </Animated.View>

      {NODES.map((n, i) => (
        <Animated.View
          key={n.label}
          entering={FadeIn.delay(i * 100).duration(300)}
          style={[styles.node, { left: n.x - 36 }]}>
          <View style={[ss.glassCard, styles.nodeCard]}>
            <GinitSymbolicIcon name={n.icon} size={26} color={GinitTheme.colors.primary} />
            <Text style={ss.chipText}>{n.label}</Text>
          </View>
        </Animated.View>
      ))}

      <Animated.View style={[styles.chatBubble, bubbleStyle]}>
        <Text style={styles.chatText}>다음 모임 7시에 봐요!</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  arcLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  node: {
    position: 'absolute',
    top: 100,
    width: 72,
    alignItems: 'center',
  },
  nodeCard: { alignItems: 'center', gap: 4 },
  chatBubble: {
    alignSelf: 'center',
    marginTop: 168,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  chatText: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.text },
});
