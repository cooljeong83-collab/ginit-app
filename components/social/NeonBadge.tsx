import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GinitTheme } from '@/constants/ginit-theme';

const AnimatedView = Animated.createAnimatedComponent(View);

type Props = {
  /** 홈 `HomeMeetingListItem`의 조율 상태 배지와 동일 역할 — 짧은 라벨 1~2줄 */
  label: string;
  /** 일정·장소 조율 중일 때와 같은 미세 펄스 */
  pulse?: boolean;
};

/**
 * 홈 모임 카드 우측 상단 `NeonHeadBadge` 톤을 재사용한 배지입니다.
 */
export function NeonBadge({ label, pulse = false }: Props) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (pulse) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 820, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 820, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 160 });
    }
  }, [pulse, scale]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedView style={[styles.neonBadgeOuter, pulse && styles.neonBadgePulseWrap, pulseStyle]}>
      <View style={styles.neonBadgeInner}>
        <Text style={styles.neonBadgeStatus} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </AnimatedView>
  );
}

const styles = StyleSheet.create({
  neonBadgeOuter: {
    alignSelf: 'flex-end',
  },
  neonBadgePulseWrap: {
    shadowColor: 'rgba(134, 211, 183, 0.45)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 3,
  },
  neonBadgeInner: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(134, 211, 183, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.45)',
    alignItems: 'flex-end',
  },
  neonBadgeStatus: {
    fontSize: 10,
    fontWeight: '900',
    color: GinitTheme.colors.textSub,
    letterSpacing: -0.2,
    textAlign: 'right',
  },
});
