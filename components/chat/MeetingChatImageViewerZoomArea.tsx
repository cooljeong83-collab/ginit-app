import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

type Props = {
  uri: string;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.25;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, v));
}

function maxTranslateForScale(containerSize: number, scale: number): number {
  'worklet';
  if (scale <= 1) return 0;
  // `contain` 기준에서 화면 밖으로 너무 멀리 나가지 않게 하는 보수적 바운더리.
  // 이미지가 화면에 맞춰 들어가므로, 확대 시 추가로 생기는 여백의 절반만큼만 이동 허용.
  return (containerSize * (scale - 1)) / 2;
}

/**
 * 채팅 이미지 전체보기 모달용: 핀치 줌 + 확대 시 팬 (웹은 일반 이미지).
 */
export function MeetingChatImageViewerZoomArea({ uri }: Props) {
  if (Platform.OS === 'web') {
    return <Image source={{ uri }} style={styles.image} contentFit="contain" />;
  }

  return <ZoomableNative uri={uri} />;
}

function ZoomableNative({ uri }: Props) {
  const layoutW = useSharedValue(0);
  const layoutH = useSharedValue(0);

  const scale = useSharedValue(1);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Reanimated shared refs are stable; reset transforms only when the image URL changes.
  useEffect(() => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinchStartScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinchStartScale.value = scale.value;
    })
    .onUpdate((e) => {
      const next = clamp(pinchStartScale.value * e.scale, MIN_SCALE, MAX_SCALE);
      scale.value = next;
      const maxX = maxTranslateForScale(layoutW.value, next);
      const maxY = maxTranslateForScale(layoutH.value, next);
      translateX.value = clamp(translateX.value, -maxX, maxX);
      translateY.value = clamp(translateY.value, -maxY, maxY);
    })
    .onEnd(() => {
      const next = clamp(scale.value, MIN_SCALE, MAX_SCALE);
      scale.value = withTiming(next, { duration: 140 });
      const maxX = maxTranslateForScale(layoutW.value, next);
      const maxY = maxTranslateForScale(layoutH.value, next);
      translateX.value = withTiming(clamp(translateX.value, -maxX, maxX), { duration: 140 });
      translateY.value = withTiming(clamp(translateY.value, -maxY, maxY), { duration: 140 });
      if (next <= MIN_SCALE + 0.0001) {
        translateX.value = withTiming(0, { duration: 160 });
        translateY.value = withTiming(0, { duration: 160 });
      }
    });

  const pan = Gesture.Pan()
    // 확대( scale > 1 )일 때만 팬을 켜고, 기본 배율에서는 실패시켜 상위 `FlatList` 가로 페이징이 동작하게 함
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      'worklet';
      if (scale.value > MIN_SCALE + 0.02) {
        state.activate();
      } else {
        state.fail();
      }
    })
    // 2손가락 제스처(핀치) 중에는 Pan이 개입하지 않도록 제한
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      panStartX.value = translateX.value;
      panStartY.value = translateY.value;
    })
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE + 0.0001) return;
      const maxX = maxTranslateForScale(layoutW.value, scale.value);
      const maxY = maxTranslateForScale(layoutH.value, scale.value);
      translateX.value = clamp(panStartX.value + e.translationX, -maxX, maxX);
      translateY.value = clamp(panStartY.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      const maxX = maxTranslateForScale(layoutW.value, scale.value);
      const maxY = maxTranslateForScale(layoutH.value, scale.value);
      translateX.value = withTiming(clamp(translateX.value, -maxX, maxX), { duration: 120 });
      translateY.value = withTiming(clamp(translateY.value, -maxY, maxY), { duration: 120 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(400)
    .onEnd(() => {
      const zoomed = scale.value > MIN_SCALE + 0.02;
      if (zoomed) {
        scale.value = withTiming(MIN_SCALE, { duration: 180 });
        translateX.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
        return;
      }
      const next = DOUBLE_TAP_SCALE;
      scale.value = withTiming(next, { duration: 180 });
      const maxX = maxTranslateForScale(layoutW.value, next);
      const maxY = maxTranslateForScale(layoutH.value, next);
      translateX.value = withTiming(clamp(translateX.value, -maxX, maxX), { duration: 180 });
      translateY.value = withTiming(clamp(translateY.value, -maxY, maxY), { duration: 180 });
    });

  // 핀치는 2손가락 전용으로 Exclusive 밖에 두어, doubleTap과 경쟁하지 않게 함
  const composed = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.max(0, Math.floor(width));
    const h = Math.max(0, Math.floor(height));
    layoutW.value = w;
    layoutH.value = h;
  };

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.zoomHost} onLayout={onLayout}>
        <Animated.View style={[styles.zoomInner, animatedStyle]}>
          <Image source={{ uri }} style={styles.image} contentFit="contain" pointerEvents="none" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  zoomHost: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomInner: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
});
