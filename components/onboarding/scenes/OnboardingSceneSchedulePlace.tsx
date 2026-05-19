import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { ONBOARDING_STAGGER_MS } from '@/components/onboarding/onboarding-motion';
import { onboardingSceneStyles as ss } from '@/components/onboarding/scenes/onboarding-scene-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

const CHIPS = ['토 19:00', '일 14:00', '강남역 ☕', '홍대 🍺'] as const;
const AVATARS = ['A', 'B', 'C', 'D'] as const;

type Props = { isActive: boolean };

export function OnboardingSceneSchedulePlace({ isActive }: Props) {
  const pinScale = useSharedValue(0.6);

  useEffect(() => {
    if (!isActive) {
      pinScale.value = 0.6;
      return;
    }
    pinScale.value = withDelay(400, withSpring(1, { damping: 12, stiffness: 160 }));
  }, [isActive, pinScale]);

  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinScale.value }],
  }));

  if (!isActive) return <View style={ss.hero} />;

  return (
    <View style={ss.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.avatarRow}>
        {AVATARS.map((letter, i) => (
          <Animated.View
            key={letter}
            entering={FadeIn.delay(i * ONBOARDING_STAGGER_MS).duration(260)}
            style={[styles.avatar, i > 0 && styles.avatarOverlap]}>
            <Text style={styles.avatarText}>{letter}</Text>
          </Animated.View>
        ))}
        <GinitSymbolicIcon name="sparkles-outline" size={18} color={GinitTheme.colors.accent} style={styles.heart} />
      </View>
      <View style={styles.chips}>
        {CHIPS.map((chip, i) => (
          <Animated.View
            key={chip}
            entering={FadeInDown.delay(120 + i * ONBOARDING_STAGGER_MS).duration(280)}
            style={ss.chip}>
            <Text style={ss.chipText}>{chip}</Text>
          </Animated.View>
        ))}
      </View>
      <Animated.View style={[styles.pinWrap, pinStyle]}>
        <View style={[ss.glassCard, styles.pinCard]}>
          <GinitSymbolicIcon name="location-outline" size={24} color={GinitTheme.colors.primary} />
          <Text style={ss.accent}>자주 가던 장소 추천</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOverlap: { marginLeft: -10 },
  avatarText: { fontSize: 13, fontWeight: '800', color: GinitTheme.colors.primary },
  heart: { marginLeft: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 14 },
  pinWrap: { alignItems: 'center' },
  pinCard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
