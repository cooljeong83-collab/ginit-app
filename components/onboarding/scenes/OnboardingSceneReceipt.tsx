import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

const SPLITS = [
  { name: '민수', pct: 0.35 },
  { name: '지연', pct: 0.25 },
  { name: '나', pct: 0.4 },
] as const;

type Props = { isActive: boolean };

export function OnboardingSceneReceipt({ isActive }: Props) {
  const scan = useSharedValue(0);
  const bars = useSharedValue(0);

  useEffect(() => {
    if (!isActive) {
      scan.value = 0;
      bars.value = 0;
      return;
    }
    scan.value = withRepeat(
      withSequence(withTiming(1, { duration: 900 }), withTiming(0, { duration: 200 })),
      -1,
      false,
    );
    bars.value = withDelay(500, withSpring(1, { damping: 14, stiffness: 90 }));
  }, [isActive, scan, bars]);

  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scan.value * 100 }],
    opacity: scan.value > 0.05 ? 0.85 : 0,
  }));

  if (!isActive) return <View style={ss.hero} />;

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View entering={FadeIn.duration(300)} style={[ss.glassCard, styles.receipt]}>
        <GinitSymbolicIcon name="card-outline" size={28} color={GinitTheme.colors.textMuted} />
        <Text style={styles.receiptTitle}>영수증</Text>
        <Text style={styles.receiptAmt}>₩48,000</Text>
        <Animated.View style={[styles.scanLine, scanStyle]} />
      </Animated.View>
      <Text style={styles.aiLine}>AI가 영수증 내용을 확인했어요</Text>
      <View style={styles.bars}>
        {SPLITS.map((s, i) => (
          <SplitBar key={s.name} split={s} index={i} progress={bars} />
        ))}
      </View>
    </View>
  );
}

function SplitBar({
  split,
  index,
  progress,
}: {
  split: (typeof SPLITS)[number];
  index: number;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    width: `${split.pct * 100 * progress.value}%`,
    opacity: progress.value,
  }));

  return (
    <View style={styles.barRow}>
      <Text style={ss.label}>{split.name}</Text>
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            { backgroundColor: index === 2 ? GinitTheme.colors.primary : GinitTheme.colors.accent },
            style,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  receipt: {
    width: 140,
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
    minHeight: 120,
  },
  receiptTitle: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.textMuted },
  receiptAmt: { fontSize: 18, fontWeight: '800', color: GinitTheme.colors.text },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: GinitTheme.colors.success,
  },
  aiLine: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.success,
  },
  bars: { marginTop: 14, alignSelf: 'stretch', paddingHorizontal: 8, gap: 8 },
  barRow: { gap: 4 },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(148, 163, 184, 0.25)',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 4 },
});
