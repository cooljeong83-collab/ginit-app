import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { useOnboardingSceneActive } from '@/components/onboarding/scenes/use-onboarding-scene-active';

const NODES = [
  { icon: 'person-outline' as const, label: '앱' },
  { icon: 'map-outline' as const, label: '지도' },
  { icon: 'chatbubbles-outline' as const, label: '채팅' },
] as const;

type Props = { isActive: boolean };

export function OnboardingSceneConnect({ isActive }: Props) {
  const phase = useOnboardingSceneActive(isActive);
  const lineOpacity = useSharedValue(0.4);

  useEffect(() => {
    if (!isActive) {
      lineOpacity.value = 0.4;
      return;
    }
    lineOpacity.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
  }, [isActive, lineOpacity]);

  const lineStyle = useAnimatedStyle(() => ({
    opacity: lineOpacity.value,
  }));

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -12 + phase.value * -18 }],
    opacity: 0.7 + phase.value * 0.3,
  }));

  if (!isActive) return <View style={ss.hero} />;

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.connectorRow}>
        <Animated.View style={[styles.connector, lineStyle]} />
        <Animated.View style={[styles.connector, lineStyle]} />
      </View>
      <View style={styles.nodeRow}>
        {NODES.map((n, i) => (
          <Animated.View key={n.label} entering={FadeIn.delay(i * 100).duration(300)} style={styles.node}>
            <View style={[ss.glassCard, styles.nodeCard]}>
              <GinitSymbolicIcon name={n.icon} size={26} color={GinitTheme.colors.primary} />
              <Text style={ss.chipText}>{n.label}</Text>
            </View>
          </Animated.View>
        ))}
      </View>
      <Animated.View style={[styles.chatBubble, bubbleStyle]}>
        <Text style={styles.chatText}>다음 모임 7시에 봐요!</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  connectorRow: {
    flexDirection: 'row',
    width: 200,
    gap: 12,
    marginBottom: 8,
    marginTop: 8,
  },
  connector: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: GinitTheme.colors.primary,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: GinitTheme.colors.primary,
  },
  nodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 260,
  },
  node: { flex: 1, alignItems: 'center' },
  nodeCard: { alignItems: 'center', gap: 4 },
  chatBubble: {
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  chatText: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.text },
});
