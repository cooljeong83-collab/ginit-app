import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 자동 적용 한 단계의 리플·눌림이 인지될 만큼 유지(ms) jjg */
export const AGENT_APPLY_TAP_HOLD_MS = 560;
/** 단계 사이 손가락을 옮기는 듯한 짧은 간격(ms) */
export const AGENT_APPLY_STEP_GAP_MS = 300;
/** 2단계 레이아웃 안정화 후 메뉴 칩 연출까지 여유(ms) */
export const AGENT_APPLY_POST_LAYOUT_MS = 680;
/** 이미 맞춰진 공개/비공개만 짧게 재강조(ms) */
export const AGENT_APPLY_QUICK_ACK_MS = 340;
/** 자동 생성 모임 이름 — 코드포인트마다 `value` 갱신 간격(ms), 사람이 타이핑하는 듯한 속도 */
export const AGENT_APPLY_TITLE_MS_PER_CODEPOINT = 42;

const RIPPLE_EXPAND_MS = 420;

export type AgentApplyRippleSize = 'sm' | 'md' | 'lg';

type AgentApplyRippleLayerProps = {
  active: boolean;
  size?: AgentApplyRippleSize;
};

/**
 * FAB 자동 위저드 적용 시, 실제 탭 없이도 중앙에서 퍼지는 리플을 한 번 재생합니다.
 * 부모 `Pressable`/`View`는 `overflow: 'hidden'`과 `borderRadius`가 잡혀 있어야 잘립니다.
 */
export function AgentApplyRippleLayer({ active, size = 'sm' }: AgentApplyRippleLayerProps) {
  const pr = useRef(new Animated.Value(0)).current;
  const runRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    runRef.current?.stop();
    if (!active) {
      pr.setValue(0);
      return;
    }
    pr.setValue(0);
    runRef.current = Animated.timing(pr, {
      toValue: 1,
      duration: RIPPLE_EXPAND_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    runRef.current.start();
    return () => {
      runRef.current?.stop();
    };
  }, [active, pr]);

  const dim = size === 'lg' ? 160 : size === 'md' ? 120 : 88;
  const scale = pr.interpolate({ inputRange: [0, 1], outputRange: [0.1, 6.5] });
  const opacity = pr.interpolate({
    inputRange: [0, 0.06, 0.32, 1],
    outputRange: [0, 0.26, 0.12, 0],
    extrapolate: 'clamp',
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <View style={styles.rippleHost}>
        <Animated.View
          style={{
            width: dim,
            height: dim,
            borderRadius: dim / 2,
            backgroundColor: GinitTheme.colors.primary,
            opacity,
            transform: [{ scale }],
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rippleHost: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
