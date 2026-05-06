import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import type { ProfilePhotoCover } from '@/src/lib/profile-photo-cover';

const MAX_SCALE = 6;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, v));
}

type Props = {
  visible: boolean;
  uri: string;
  imageWidth?: number;
  imageHeight?: number;
  onRequestClose: () => void;
  onConfirm: (cover: ProfilePhotoCover) => void;
};

/**
 * 네이티브 전용: 정사각 프레임(마스크) 안에서 핀치·팬으로 보일 영역을 고른 뒤 ax/ay/z 메타를 돌려줍니다.
 * 업로드 파일은 별도로 원본 비율로 올립니다.
 */
export function ProfilePhotoCropModal({ visible, uri, imageWidth, imageHeight, onRequestClose, onConfirm }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [resolved, setResolved] = useState<{ iw: number; ih: number } | null>(() =>
    typeof imageWidth === 'number' &&
      typeof imageHeight === 'number' &&
      imageWidth > 0 &&
      imageHeight > 0
      ? { iw: imageWidth, ih: imageHeight }
      : null,
  );

  useEffect(() => {
    if (!visible) return;
    if (
      typeof imageWidth === 'number' &&
      typeof imageHeight === 'number' &&
      imageWidth > 0 &&
      imageHeight > 0
    ) {
      setResolved({ iw: imageWidth, ih: imageHeight });
      return;
    }
    let alive = true;
    setResolved(null);
    RNImage.getSize(
      uri,
      (w, h) => {
        if (!alive) return;
        if (w > 0 && h > 0) setResolved({ iw: w, ih: h });
      },
      () => {
        if (!alive) return;
        setResolved(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [visible, uri, imageWidth, imageHeight]);

  const S = Math.min(winW, winH) * 0.72;
  const cx = winW / 2;
  const cy = winH / 2;

  const geom = useMemo(() => {
    if (!resolved) return null;
    const s0 = Math.max(S / resolved.iw, S / resolved.ih);
    const w0 = resolved.iw * s0;
    const h0 = resolved.ih * s0;
    return { w0, h0 };
  }, [resolved, S]);

  if (Platform.OS === 'web') return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onRequestClose}>
      <GestureHandlerRootView style={styles.gestureRoot}>
        {geom ? (
          <CropStage
            uri={uri}
            w0={geom.w0}
            h0={geom.h0}
            S={S}
            cx={cx}
            cy={cy}
            winW={winW}
            winH={winH}
            insetsBottom={insets.bottom}
            onRequestClose={onRequestClose}
            onConfirm={onConfirm}
          />
        ) : (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.loadingText}>사진을 불러오는 중…</Text>
            <Pressable onPress={onRequestClose} style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.85 }]}>
              <Text style={styles.textBtnLabel}>닫기</Text>
            </Pressable>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

function CropStage({
  uri,
  w0,
  h0,
  S,
  cx,
  cy,
  winW,
  winH,
  insetsBottom,
  onRequestClose,
  onConfirm,
}: {
  uri: string;
  w0: number;
  h0: number;
  S: number;
  cx: number;
  cy: number;
  winW: number;
  winH: number;
  insetsBottom: number;
  onRequestClose: () => void;
  onConfirm: (cover: ProfilePhotoCover) => void;
}) {
  const w0Sv = useSharedValue(w0);
  const h0Sv = useSharedValue(h0);
  const SSv = useSharedValue(S);
  const cxSv = useSharedValue(cx);
  const cySv = useSharedValue(cy);

  useEffect(() => {
    w0Sv.value = w0;
    h0Sv.value = h0;
    SSv.value = S;
    cxSv.value = cx;
    cySv.value = cy;
  }, [w0, h0, S, cx, cy, w0Sv, h0Sv, SSv, cxSv, cySv]);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const pinchStartScale = useSharedValue(1);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);

  useEffect(() => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  }, [uri, scale, translateX, translateY]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinchStartScale.value = scale.value;
    })
    .onUpdate((e) => {
      const next = clamp(pinchStartScale.value * e.scale, 1, MAX_SCALE);
      scale.value = next;
      const dw = w0Sv.value * next;
      const dh = h0Sv.value * next;
      const maxTx = Math.max(0, (dw - SSv.value) / 2);
      const maxTy = Math.max(0, (dh - SSv.value) / 2);
      translateX.value = clamp(translateX.value, -maxTx, maxTx);
      translateY.value = clamp(translateY.value, -maxTy, maxTy);
    })
    .onEnd(() => {
      const next = clamp(scale.value, 1, MAX_SCALE);
      scale.value = withTiming(next, { duration: 120 });
      const dw = w0Sv.value * next;
      const dh = h0Sv.value * next;
      const maxTx = Math.max(0, (dw - SSv.value) / 2);
      const maxTy = Math.max(0, (dh - SSv.value) / 2);
      translateX.value = withTiming(clamp(translateX.value, -maxTx, maxTx), { duration: 120 });
      translateY.value = withTiming(clamp(translateY.value, -maxTy, maxTy), { duration: 120 });
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      panStartX.value = translateX.value;
      panStartY.value = translateY.value;
    })
    .onUpdate((e) => {
      const dw = w0Sv.value * scale.value;
      const dh = h0Sv.value * scale.value;
      const maxTx = Math.max(0, (dw - SSv.value) / 2);
      const maxTy = Math.max(0, (dh - SSv.value) / 2);
      translateX.value = clamp(panStartX.value + e.translationX, -maxTx, maxTx);
      translateY.value = clamp(panStartY.value + e.translationY, -maxTy, maxTy);
    })
    .onEnd(() => {
      const dw = w0Sv.value * scale.value;
      const dh = h0Sv.value * scale.value;
      const maxTx = Math.max(0, (dw - SSv.value) / 2);
      const maxTy = Math.max(0, (dh - SSv.value) / 2);
      translateX.value = withTiming(clamp(translateX.value, -maxTx, maxTx), { duration: 100 });
      translateY.value = withTiming(clamp(translateY.value, -maxTy, maxTy), { duration: 100 });
    });

  const composed = Gesture.Simultaneous(pinch, pan);

  const imageBoxStyle = useAnimatedStyle(() => {
    const z = scale.value;
    const dw = w0Sv.value * z;
    const dh = h0Sv.value * z;
    return {
      position: 'absolute' as const,
      width: dw,
      height: dh,
      left: cxSv.value - dw / 2 + translateX.value,
      top: cySv.value - dh / 2 + translateY.value,
    };
  });

  const holeLeft = cx - S / 2;
  const holeTop = cy - S / 2;

  const onPressConfirm = () => {
    runOnUI(() => {
      'worklet';
      const z = Math.min(MAX_SCALE, Math.max(1, scale.value));
      const tx = translateX.value;
      const ty = translateY.value;
      const w0w = w0Sv.value;
      const h0w = h0Sv.value;
      const cxw = cxSv.value;
      const cyw = cySv.value;
      const dw = w0w * z;
      const dh = h0w * z;
      const left = cxw - dw / 2 + tx;
      const top = cyw - dh / 2 + ty;
      let ax = (cxw - left) / dw;
      let ay = (cyw - top) / dh;
      ax = clamp(ax, 0, 1);
      ay = clamp(ay, 0, 1);
      runOnJS(onConfirm)({ ax, ay, z });
    })();
  };

  return (
    <View style={styles.root}>
      <GestureDetector gesture={composed}>
        <View style={StyleSheet.absoluteFill} pointerEvents="auto">
          <Animated.View style={imageBoxStyle}>
            <Image source={{ uri }} style={styles.imageFill} contentFit="fill" pointerEvents="none" />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.dim, { width: winW, height: Math.max(0, holeTop) }]} />
        <View style={{ flexDirection: 'row', width: winW, height: S }}>
          <View style={[styles.dim, { width: Math.max(0, holeLeft), height: S }]} />
          <View style={{ width: S, height: S, borderWidth: 2, borderColor: 'rgba(255,255,255,0.95)' }} />
          <View style={[styles.dim, { flex: 1, height: S }]} />
        </View>
        <View style={[styles.dim, { width: winW, flex: 1 }]} />
      </View>

      <View style={[styles.bottomBar, { paddingBottom: 12 + insetsBottom }]} pointerEvents="auto">
        <Text style={styles.hint}>사진을 확대·이동해 원 안에 보일 영역을 맞춘 뒤 확인을 눌러 주세요.</Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onRequestClose}
            style={({ pressed }) => [styles.btnGhost, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="취소">
            <Text style={styles.btnGhostText}>취소</Text>
          </Pressable>
          <Pressable
            onPress={onPressConfirm}
            style={({ pressed }) => [styles.btnPrimary, pressed && { opacity: 0.88 }]}
            accessibilityRole="button"
            accessibilityLabel="확인">
            <Text style={styles.btnPrimaryText}>확인</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
  root: { flex: 1, backgroundColor: 'transparent' },
  imageFill: { width: '100%', height: '100%' },
  dim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  loadingText: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  textBtn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 18 },
  textBtnLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  hint: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 18,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
  },
  btnGhostText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
