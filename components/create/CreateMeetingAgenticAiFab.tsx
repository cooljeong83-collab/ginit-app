import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCreateMeetingAgenticAi } from '@/components/create/CreateMeetingAgenticAiContext';
import {
  CREATE_MEETING_AGENT_BUBBLE_SPRING as BUBBLE_SPRING,
  CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS,
  CREATE_MEETING_AGENT_TYPING_CARET_BLINK_MS,
  CREATE_MEETING_AGENT_TYPING_INTERVAL_MS,
  CREATE_MEETING_AGENT_TYPING_LAG_AFTER_BUBBLE_MS,
  MEETING_CREATE_FAB_BTN_SIZE as BTN_SIZE,
  MEETING_CREATE_FAB_STACK_H as FAB_STACK_H,
  MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT as FLOOR_SHADOW_SLOT,
  MEETING_CREATE_FAB_LOGO as LOGO_SYMBOL,
  MEETING_CREATE_FAB_GRADIENT_COLORS,
  MEETING_CREATE_FAB_IDLE_BOB_DELAY_MS,
  MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS,
  MEETING_CREATE_FAB_IDLE_BREATHE_MUL,
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE,
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL,
  MEETING_CREATE_FAB_SHADOW_FADE_IN_FROM_TY,
  MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MAX,
  MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MIN,
  MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MAX,
  MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MIN,
  MEETING_CREATE_FAB_RISE_FROM as RISE_FROM,
  MEETING_CREATE_FAB_RISE_SPRING as RISE_SPRING,
  MEETING_CREATE_FAB_SHADOW_BLOB as SHADOW_BLOB,
} from '@/components/create/meetingCreateFabShared';
import { GinitTheme } from '@/constants/ginit-theme';
import { homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import {
  notifyCreateMeetingAgentBubbleDismiss,
  subscribeCreateMeetingAgentBubbleDismiss,
} from '@/src/lib/create-meeting-agent-bubble-dismiss';

const FAB_MARGIN = 26;

function AiCircleButton({ pressed }: { pressed?: boolean }) {
  return (
    <View style={[styles.aiCircleOuter, pressed && { opacity: 0.86 }]}>
      <LinearGradient
        colors={MEETING_CREATE_FAB_GRADIENT_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.aiCircleGradient}>
        <Image source={LOGO_SYMBOL} style={styles.aiLogo} contentFit="contain" accessibilityIgnoresInvertColors />
      </LinearGradient>
    </View>
  );
}

/**
 * 모임 생성 — 하단 타원 그림자는 상승과 동시에 보이고, 상승 후에는 살짝 둥둥 떠 있는 느낌.
 */
export function CreateMeetingAgenticAiFab() {
  const insets = useSafeAreaInsets();
  const {
    mzLine,
    showAcceptButton,
    runAcceptSuggestion,
    secondaryActionLabel,
    runSecondaryAction,
  } = useCreateMeetingAgenticAi();

  const geo = useMemo(
    () => ({
      finalRight: FAB_MARGIN + insets.right,
      finalBottom: FAB_MARGIN + insets.bottom,
    }),
    [insets.right, insets.bottom],
  );

  const btnTy = useSharedValue(RISE_FROM);
  const btnScale = useSharedValue(0.88);
  /** 그림자는 상승 시작부터 항상 보이도록 1 유지 */
  const floorShadowP = useSharedValue(1);
  const riseDone = useSharedValue(0);
  const idleFloat = useSharedValue(0);
  const bubbleProg = useSharedValue(0);
  const bubbleDismiss = useSharedValue(0);

  const [typedLen, setTypedLen] = useState(0);
  const [showCaret, setShowCaret] = useState(true);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const caretTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingKickoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fullText = mzLine;
  const graphemes = useMemo(() => Array.from(fullText), [fullText]);
  const isThinkingLine = fullText.trim() === '생각 중입니다…';

  const clearTypingTimers = useCallback(() => {
    if (typingTimerRef.current != null) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (caretTimerRef.current != null) {
      clearInterval(caretTimerRef.current);
      caretTimerRef.current = null;
    }
    if (typingKickoffRef.current != null) {
      clearTimeout(typingKickoffRef.current);
      typingKickoffRef.current = null;
    }
  }, []);

  const startTypingLoop = useCallback(() => {
    setTypedLen(0);
    setShowCaret(true);
    typingTimerRef.current = setInterval(() => {
      setTypedLen((prev) => {
        if (prev >= graphemes.length) {
          if (typingTimerRef.current != null) {
            clearInterval(typingTimerRef.current);
            typingTimerRef.current = null;
          }
          return prev;
        }
        const next = prev + 1;
        if (next >= graphemes.length && typingTimerRef.current != null) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        return next;
      });
    }, CREATE_MEETING_AGENT_TYPING_INTERVAL_MS);
  }, [graphemes.length]);

  const onRiseSettled = useCallback(() => {
    idleFloat.value = 0;
    idleFloat.value = withDelay(
      MEETING_CREATE_FAB_IDLE_BOB_DELAY_MS,
      withRepeat(
        withTiming(1, {
          duration: MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );
  }, [idleFloat]);

  const onRiseSettledRef = useRef(onRiseSettled);
  onRiseSettledRef.current = onRiseSettled;

  const invokePostRiseFromUi = useCallback(() => {
    onRiseSettledRef.current();
  }, []);

  const runBubbleDismiss = useCallback(() => {
    clearTypingTimers();
    bubbleDismiss.value = withTiming(1, { duration: 220, easing: Easing.in(Easing.quad) });
  }, [bubbleDismiss, clearTypingTimers]);

  useEffect(() => {
    const unsub = subscribeCreateMeetingAgentBubbleDismiss(runBubbleDismiss);
    return unsub;
  }, [runBubbleDismiss]);

  useEffect(() => {
    btnTy.value = RISE_FROM;
    btnScale.value = 0.88;
    floorShadowP.value = 1;
    riseDone.value = 0;
    idleFloat.value = 0;
    bubbleProg.value = 0;
    bubbleDismiss.value = 0;
    setTypedLen(0);
    setShowCaret(true);
    clearTypingTimers();

    bubbleProg.value = 0;
    bubbleProg.value = withDelay(
      CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS,
      withSpring(1, BUBBLE_SPRING),
    );

    if (isThinkingLine) {
      typingKickoffRef.current = setTimeout(() => {
        setTypedLen(graphemes.length);
        setShowCaret(false);
      }, CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS + 40);
    } else {
      const typingKickMs =
        CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS + CREATE_MEETING_AGENT_TYPING_LAG_AFTER_BUBBLE_MS;
      typingKickoffRef.current = setTimeout(() => {
        startTypingLoop();
        caretTimerRef.current = setInterval(() => {
          setShowCaret((c) => !c);
        }, CREATE_MEETING_AGENT_TYPING_CARET_BLINK_MS);
      }, typingKickMs);
    }

    btnTy.value = withSpring(0, RISE_SPRING, (finished) => {
      if (finished) {
        riseDone.value = 1;
        runOnJS(invokePostRiseFromUi)();
      }
    });
    btnScale.value = withSpring(1, RISE_SPRING);

    return () => {
      clearTypingTimers();
    };
  }, [
    fullText,
    clearTypingTimers,
    graphemes.length,
    invokePostRiseFromUi,
    isThinkingLine,
    startTypingLoop,
  ]); // eslint-disable-line react-hooks/exhaustive-deps -- 문구 변경 시에만 시퀀스 재생

  const typingDone = typedLen >= graphemes.length;
  const displayText = graphemes.slice(0, typedLen).join('');

  useEffect(() => {
    if (!typingDone) return;
    if (caretTimerRef.current != null) {
      clearInterval(caretTimerRef.current);
      caretTimerRef.current = null;
    }
    setShowCaret(false);
  }, [typingDone]);

  const floorShadowStyle = useAnimatedStyle(() => {
    const p = floorShadowP.value;
    const fadeIn = interpolate(
      btnTy.value,
      [MEETING_CREATE_FAB_SHADOW_FADE_IN_FROM_TY, 0],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const f = idleFloat.value;
    const floatPart = MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE + (f - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL;
    const liftY = btnTy.value + floatPart;
    const pulse = interpolate(
      liftY,
      [MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MIN, MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MAX],
      [MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MIN, MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MAX],
      Extrapolation.CLAMP,
    );
    const baseO = interpolate(p, [0, 1], [0, 0.32], Extrapolation.CLAMP);
    const o = baseO * fadeIn;
    const sx = interpolate(p, [0, 1], [0.45, 1.75], Extrapolation.CLAMP) * pulse * fadeIn;
    const sy = interpolate(p, [0, 1], [0.28, 0.32], Extrapolation.CLAMP) * pulse * fadeIn;
    return {
      opacity: o,
      transform: [{ scaleX: sx }, { scaleY: sy }],
    };
  });

  const btnStyle = useAnimatedStyle(() => {
    const f = idleFloat.value;
    const floatPart = MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE + (f - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL;
    const scale = btnScale.value * (1 + (f - 0.5) * MEETING_CREATE_FAB_IDLE_BREATHE_MUL);
    return {
      transform: [{ translateY: btnTy.value + floatPart }, { scale }],
    };
  });

  const bubbleStyle = useAnimatedStyle(() => {
    const p = bubbleProg.value;
    const baseO = interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP);
    const tx = interpolate(p, [0, 1], [22, 0], Extrapolation.CLAMP);
    const ty = interpolate(p, [0, 1], [8, 0], Extrapolation.CLAMP);
    const dismissMul = interpolate(bubbleDismiss.value, [0, 1], [1, 0], Extrapolation.CLAMP);
    return {
      opacity: baseO * dismissMul,
      transform: [{ translateX: tx }, { translateY: ty }],
    };
  });

  const staticGlass = shouldUseStaticGlassInsteadOfBlur();

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View
        style={[
          styles.dock,
          {
            width: BTN_SIZE,
            minHeight: FAB_STACK_H + 120,
            right: geo.finalRight,
            bottom: geo.finalBottom,
          },
        ]}
        pointerEvents="box-none">
        <Animated.View style={[styles.bubbleWrap, bubbleStyle]} pointerEvents="box-none">
          <View style={styles.bubbleClip} pointerEvents="box-none">
            {staticGlass ? (
              <View style={[StyleSheet.absoluteFillObject, styles.bubbleStaticGlass]} />
            ) : (
              <BlurView
                intensity={homeBlurIntensity}
                tint="light"
                experimentalBlurMethod="dimezisBlurView"
                style={StyleSheet.absoluteFillObject}
              />
            )}
            <Text style={styles.bubbleText} pointerEvents="none">
              {displayText}
              {!typingDone ? (
                <Text style={[styles.bubbleCaret, { opacity: showCaret ? 1 : 0.2 }]}>▍</Text>
              ) : null}
            </Text>
            {typingDone && (showAcceptButton || secondaryActionLabel) ? (
              <View style={styles.bubbleActions} pointerEvents="box-none">
                {showAcceptButton ? (
                  <Pressable
                    onPress={() => runAcceptSuggestion()}
                    style={({ pressed }) => [styles.bubbleActionBtn, pressed && { opacity: 0.86 }]}
                    accessibilityRole="button"
                    accessibilityLabel="수락">
                    <Text style={styles.bubbleActionLabel}>수락</Text>
                  </Pressable>
                ) : null}
                {secondaryActionLabel ? (
                  <Pressable
                    onPress={() => runSecondaryAction()}
                    style={({ pressed }) => [styles.bubbleActionBtn, pressed && { opacity: 0.86 }]}
                    accessibilityRole="button"
                    accessibilityLabel={secondaryActionLabel}>
                    <Text style={styles.bubbleActionLabel}>{secondaryActionLabel}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </Animated.View>

        <View style={[styles.fabStack, { width: BTN_SIZE, height: FAB_STACK_H }]} pointerEvents="box-none">
          <View style={styles.floorShadowWrap} pointerEvents="none">
            <Animated.View style={[styles.floorShadowBlob, floorShadowStyle]} />
          </View>
          <Animated.View style={[styles.btnLift, btnStyle]}>
            <Pressable
              onPress={() => notifyCreateMeetingAgentBubbleDismiss()}
              accessibilityRole="button"
              accessibilityLabel="모임 만들기 도우미 AI"
              style={styles.pressFill}>
              {({ pressed }) => <AiCircleButton pressed={pressed} />}
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 110,
  },
  dock: {
    position: 'absolute',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  fabStack: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  floorShadowWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: FLOOR_SHADOW_SLOT + 8,
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 0,
  },
  floorShadowBlob: {
    width: SHADOW_BLOB,
    height: SHADOW_BLOB,
    borderRadius: SHADOW_BLOB / 2,
    marginBottom: 0,
    backgroundColor: '#000000',
  },
  btnLift: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: FLOOR_SHADOW_SLOT,
    width: BTN_SIZE,
    height: BTN_SIZE,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleWrap: {
    position: 'absolute',
    right: 0,
    bottom: FAB_STACK_H + 8,
    maxWidth: 300,
    minWidth: 200,
    zIndex: 3,
  },
  bubbleClip: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  bubbleStaticGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  bubbleText: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    lineHeight: 19,
  },
  bubbleCaret: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    lineHeight: 19,
  },
  bubbleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    justifyContent: 'flex-end',
  },
  bubbleActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(49, 27, 146, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  bubbleActionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
  },
  pressFill: {
    flex: 1,
  },
  aiCircleOuter: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    overflow: 'hidden',
  },
  aiCircleGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiLogo: {
    width: 30,
    height: 30,
  },
});
