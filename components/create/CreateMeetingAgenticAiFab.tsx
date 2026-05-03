import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
  MEETING_CREATE_FAB_BTN_SIZE as BTN_SIZE,
  CREATE_MEETING_AGENT_BUBBLE_FADE_IN_MS,
  CREATE_MEETING_AGENT_BUBBLE_FADE_OUT_MS,
  CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS,
  CREATE_MEETING_AGENT_TYPING_CARET_BLINK_MS,
  CREATE_MEETING_AGENT_TYPING_INTERVAL_MS,
  CREATE_MEETING_AGENT_TYPING_LAG_AFTER_BUBBLE_MS,
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
  subscribeCreateMeetingAgentBubbleDismissFromManualScroll,
  subscribeCreateMeetingAgentBubbleShow,
} from '@/src/lib/create-meeting-agent-bubble-dismiss';
import {
  getAgentFabMotionMode,
  setAgentFabMotionMode,
  setAgentStep1InteractionUnlocked,
  subscribeAgentFabMotionMode,
} from '@/src/lib/create-meeting-agent-fab-orchestration';

const FAB_MARGIN = 26;
/** `user` 모드 idle 배율 — 자동 진행 적용 전·직접 입력 구간(둥실·호흡 약화) */
const FAB_MOTION_USER_IDLE_MUL = 0.58;
/** 더블 탭 방지 — 수락 처리 직후 연속 탭 차단 */
const ACCEPT_AUTOPILOT_BUSY_CLEAR_MS = 640;
const BUBBLE_FADE_IN_EASE = { duration: CREATE_MEETING_AGENT_BUBBLE_FADE_IN_MS, easing: Easing.out(Easing.quad) } as const;
const BUBBLE_FADE_OUT_EASE = { duration: CREATE_MEETING_AGENT_BUBBLE_FADE_OUT_MS, easing: Easing.in(Easing.quad) } as const;
/** `CreateMeetingAgenticAiBootstrap`·컨텍스트 로딩과 동일 */
const AGENT_THINKING_LINE = '생각 중입니다…';
/** `cardTopRight` — 카드 테두리 대비 안쪽 여백 (버튼 우상단 기준) */
const CARD_TOP_RIGHT_INSET = 10;
/** FAB 스택 상단 → 원형 버튼 상단까지 오프셋(말풍선 top 정렬용) jjg ai 말풍선 높이 설정. */
const FAB_CIRCLE_TOP_OFFSET_IN_STACK = FAB_STACK_H - FLOOR_SHADOW_SLOT - BTN_SIZE - 26;

/** 도크 래퍼 높이 추정 — 1단계 하단 도크와 동일한 화면 Y에서 카드 우상단으로 스프링 시작 */
function estimatedAgentDockOuterHeightPx(): number {
  return FAB_STACK_H + Math.max(0, FAB_CIRCLE_TOP_OFFSET_IN_STACK) + 72;
}

export type CreateMeetingAgenticAiFabProps = {
  /** 기본: 화면 우하단. `cardTopRight`는 생성 카드 우상단. 말풍선은 FAB 왼쪽(너비는 화면 기준 상한). */
  layoutMode?: 'screenBottom' | 'cardTopRight';
  /** `layoutMode === 'cardTopRight'`일 때 `measureInWindow` 결과 */
  cardWindowRect?: { x: number; y: number; width: number; height: number } | null;
  windowWidth?: number;
  /** 위저드 단계가 올라갈 때마다 말풍선을 스크롤 닫힘과 무관하게 다시 등장(인트로)시킴 */
  wizardStep?: number;
  /** 하단 NLU 채팅 도크 등으로 `screenBottom` FAB을 위로 올릴 추가 px */
  extraScreenBottomPx?: number;
};

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
 * `cardTopRight`: 현재 단계 카드 우상단 기준. 말풍선은 FAB 왼쪽.
 */
export function CreateMeetingAgenticAiFab({
  layoutMode = 'screenBottom',
  cardWindowRect,
  windowWidth,
  wizardStep,
  extraScreenBottomPx = 0,
}: CreateMeetingAgenticAiFabProps = {}) {
  const insets = useSafeAreaInsets();
  const AIFAB_BUBBLE_WIDTH = 280;
  const { width: layoutWindowWidth, height: layoutWindowHeight } = useWindowDimensions();
  const resolvedScreenW = windowWidth ?? layoutWindowWidth;
  /** 말풍선이 화면 왼쪽에 붙지 않도록 — FAB·여백 제외한 상한(최대 약 256) jjg 말풍선 width 설정 */
  const bubbleMaxW = useMemo(() => {
    const w = resolvedScreenW;
    if (!Number.isFinite(w) || w <= 0) return AIFAB_BUBBLE_WIDTH;
    const reserve = BTN_SIZE + 8 + FAB_MARGIN * 2 + insets.left + insets.right;
    return Math.max(280, Math.min(AIFAB_BUBBLE_WIDTH, Math.floor(w - reserve)));
  }, [resolvedScreenW, insets.left, insets.right]);
  const bubbleMinW = Math.min(AIFAB_BUBBLE_WIDTH, bubbleMaxW);

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
      finalBottom: FAB_MARGIN + insets.bottom + Math.max(0, extraScreenBottomPx),
    }),
    [extraScreenBottomPx, insets.right, insets.bottom],
  );

  /** 말풍선이 길어져도 FAB 도크가 안전영역·화면 안에 남도록 잡는 여유(대략적 상한) */
  const CARD_DOCK_BUBBLE_EXTRA_BELOW_EST = 260;

  const cardDockPosition = useMemo(() => {
    if (layoutMode !== 'cardTopRight' || !cardWindowRect || windowWidth == null || windowWidth <= 0) return null;
    const { x, y, width } = cardWindowRect;
    const dockRowWLocal = bubbleMaxW + BTN_SIZE + 8;
    let top = y + CARD_TOP_RIGHT_INSET;
    let right = windowWidth - x - width + CARD_TOP_RIGHT_INSET;

    const winH = layoutWindowHeight ?? 0;
    const winW = windowWidth;
    if (winH > 0 && winW > 0) {
      const bubbleUpward = Math.max(0, -FAB_CIRCLE_TOP_OFFSET_IN_STACK);
      const padT = Math.max(insets.top, 8) + bubbleUpward + 4;
      const padB = Math.max(insets.bottom, FAB_MARGIN) + 8;
      const padL = FAB_MARGIN + insets.left + 8;
      const padR = FAB_MARGIN + insets.right;
      const dockExtentH = FAB_STACK_H + CARD_DOCK_BUBBLE_EXTRA_BELOW_EST;
      const minTop = padT;
      const maxTop = Math.max(minTop, winH - padB - dockExtentH);
      top = Math.min(Math.max(minTop, top), maxTop);

      const minRight = padR;
      const maxRight = Math.max(minRight, winW - padL - dockRowWLocal);
      right = Math.min(Math.max(minRight, right), maxRight);
    }

    return { top, right };
  }, [
    cardWindowRect,
    layoutMode,
    windowWidth,
    layoutWindowHeight,
    insets.top,
    insets.bottom,
    insets.left,
    insets.right,
    bubbleMaxW,
  ]);

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
  /** AI 버튼·스크롤 등으로 말풍선을 접었는지; AI 버튼으로 다시 펼침 */
  const [bubbleHidden, setBubbleHidden] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const caretTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingKickoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 직전 `mzLine` — 생각 중 → 본문 전환 시 FAB/말풍선 인트로 생략 */
  const prevMzLineRef = useRef<string | null>(null);
  /** 카드 도크 스프링 완료 후 말풍선 재생 — 매 렌더 최신 클로저로 갱신 */
  const bubbleAfterDockRef = useRef<() => void>(() => {});
  /** 카드 도크 이동 스프링 중 — `fullText` effect의 contentOnly가 말풍선을 다시 켜지 않도록 */
  const pendingCardDockSpringRef = useRef(false);
  /** AI FAB로 말풍선을 접은 뒤 — 같은 화면에서 FAB으로 다시 열기 전까지 자동으로 말풍선을 띄우지 않음 */
  const suppressBubbleUntilUserFabPressRef = useRef(false);
  /** 첫 FAB 상승 완료 후 — 단계별 문구만 바뀔 때 인트로·FAB 리셋 생략 */
  const fabEntranceDoneRef = useRef(false);
  /** `wizardStep` prop 직전 값 — 단계 증가 시 말풍선 재생 구분 */
  const prevWizardStepForBubbleRef = useRef<number | null>(null);

  const layoutKindSv = useSharedValue(0);
  const screenRightSv = useSharedValue(geo.finalRight);
  const screenBottomSv = useSharedValue(geo.finalBottom);
  const cardDockTopSv = useSharedValue(0);
  const cardDockRightSv = useSharedValue(0);
  const cardDockMeasuredOnceRef = useRef(false);
  /** 수락 탭 시 FAB이 스스로 이동해 클릭하는 듯한 연출 */
  const acceptAutopilotX = useSharedValue(0);
  const acceptAutopilotY = useSharedValue(0);
  const acceptAutopilotBusyRef = useRef(false);
  const acceptAutopilotBusyClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 0 = 사용자 입력 모션(user), 1 = 자동 진행 모션(auto) — idle·그림자 연출만 보간 */
  const fabMotionProfileSv = useSharedValue(0);

  useEffect(() => {
    const syncProfile = () => {
      const auto = getAgentFabMotionMode() === 'auto';
      fabMotionProfileSv.value = withTiming(auto ? 1 : 0, {
        duration: auto ? 95 : 280,
        easing: Easing.out(Easing.quad),
      });
    };
    syncProfile();
    return subscribeAgentFabMotionMode(syncProfile);
  }, [fabMotionProfileSv]);

  useEffect(() => {
    return () => {
      setAgentFabMotionMode('user');
    };
  }, []);

  const fullText = mzLine;
  const graphemes = useMemo(() => Array.from(fullText), [fullText]);
  const isThinkingLine = fullText.trim() === AGENT_THINKING_LINE;

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
    fabEntranceDoneRef.current = true;
    if (layoutMode === 'screenBottom' && wizardStep === 1) {
      setAgentStep1InteractionUnlocked(true);
    }
    onRiseSettledRef.current();
  }, [layoutMode, wizardStep]);

  const finalizeCardDockSpring = useCallback((finished: boolean) => {
    pendingCardDockSpringRef.current = false;
    if (finished) {
      bubbleAfterDockRef.current();
    }
  }, []);

  const runBubbleDismiss = useCallback(() => {
    clearTypingTimers();
    setBubbleHidden(true);
    bubbleDismiss.value = withTiming(1, BUBBLE_FADE_OUT_EASE);
  }, [bubbleDismiss, clearTypingTimers]);

  const reopenAgentBubbleFromUserIntent = useCallback(() => {
    suppressBubbleUntilUserFabPressRef.current = false;
    setBubbleHidden(false);
    bubbleDismiss.value = 0;
    bubbleProg.value = 0;
    bubbleProg.value = withTiming(1, BUBBLE_FADE_IN_EASE);
    clearTypingTimers();
    if (isThinkingLine) {
      setTypedLen(graphemes.length);
      setShowCaret(false);
    } else {
      setTypedLen(0);
      setShowCaret(true);
      typingKickoffRef.current = setTimeout(() => {
        startTypingLoop();
        caretTimerRef.current = setInterval(() => {
          setShowCaret((c) => !c);
        }, CREATE_MEETING_AGENT_TYPING_CARET_BLINK_MS);
      }, CREATE_MEETING_AGENT_BUBBLE_FADE_IN_MS + CREATE_MEETING_AGENT_TYPING_LAG_AFTER_BUBBLE_MS);
    }
  }, [
    bubbleDismiss,
    bubbleProg,
    clearTypingTimers,
    graphemes.length,
    isThinkingLine,
    startTypingLoop,
  ]);

  useEffect(() => {
    const unsubDismiss = subscribeCreateMeetingAgentBubbleDismiss(runBubbleDismiss);
    const unsubManualScroll = subscribeCreateMeetingAgentBubbleDismissFromManualScroll(() => {
      suppressBubbleUntilUserFabPressRef.current = true;
      runBubbleDismiss();
    });
    const unsubShow = subscribeCreateMeetingAgentBubbleShow(reopenAgentBubbleFromUserIntent);
    return () => {
      unsubDismiss();
      unsubManualScroll();
      unsubShow();
    };
  }, [reopenAgentBubbleFromUserIntent, runBubbleDismiss]);

  useEffect(() => {
    screenRightSv.value = geo.finalRight;
    screenBottomSv.value = geo.finalBottom;
  }, [geo.finalBottom, geo.finalRight, screenBottomSv, screenRightSv]);

  useLayoutEffect(() => {
    if (layoutMode !== 'cardTopRight') {
      layoutKindSv.value = 0;
      if (layoutMode === 'screenBottom') {
        cardDockMeasuredOnceRef.current = false;
      }
      return;
    }
    if (!cardDockPosition) {
      layoutKindSv.value = 0;
      return;
    }
    layoutKindSv.value = 1;
    const { top, right } = cardDockPosition;
    if (!cardDockMeasuredOnceRef.current) {
      const winH = layoutWindowHeight ?? 0;
      if (winH > 0) {
        const dockH = estimatedAgentDockOuterHeightPx();
        const startTop = Math.max(0, winH - geo.finalBottom - dockH);
        const startRight = geo.finalRight;
        layoutKindSv.value = 1;
        cardDockTopSv.value = startTop;
        cardDockRightSv.value = startRight;
        cardDockMeasuredOnceRef.current = true;
        pendingCardDockSpringRef.current = true;
        cardDockTopSv.value = withSpring(top, RISE_SPRING, (finished) => {
          runOnJS(finalizeCardDockSpring)(finished === true);
        });
        cardDockRightSv.value = withSpring(right, RISE_SPRING);
      } else {
        layoutKindSv.value = 1;
        cardDockTopSv.value = top;
        cardDockRightSv.value = right;
        cardDockMeasuredOnceRef.current = true;
      }
      return;
    }
    if (
      Math.abs(top - cardDockTopSv.value) < 0.75 &&
      Math.abs(right - cardDockRightSv.value) < 0.75
    ) {
      return;
    }
    pendingCardDockSpringRef.current = true;
    runBubbleDismiss();
    cardDockTopSv.value = withSpring(top, RISE_SPRING);
    cardDockRightSv.value = withSpring(right, RISE_SPRING, (finished) => {
      runOnJS(finalizeCardDockSpring)(finished === true);
    });
  }, [
    layoutMode,
    cardDockPosition?.top,
    cardDockPosition?.right,
    runBubbleDismiss,
    finalizeCardDockSpring,
    layoutWindowHeight,
    geo.finalBottom,
    geo.finalRight,
  ]);

  const dockCombinedStyle = useAnimatedStyle(() => {
    const tx = acceptAutopilotX.value;
    const ty = acceptAutopilotY.value;
    if (layoutKindSv.value === 0) {
      return {
        right: screenRightSv.value,
        bottom: screenBottomSv.value,
        transform: [{ translateX: tx }, { translateY: ty }],
      };
    }
    return {
      top: cardDockTopSv.value,
      right: cardDockRightSv.value,
      transform: [{ translateX: tx }, { translateY: ty }],
    };
  });

  useEffect(() => {
    const prevW = prevWizardStepForBubbleRef.current;
    const wizardStepIncreased =
      wizardStep != null && prevW != null && wizardStep > prevW;
    if (wizardStep != null) {
      prevWizardStepForBubbleRef.current = wizardStep;
    }

    const prevLine = prevMzLineRef.current;
    const softFromThinking =
      prevLine != null && prevLine.trim() === AGENT_THINKING_LINE && !isThinkingLine;
    prevMzLineRef.current = fullText;

    if (wizardStepIncreased && fabEntranceDoneRef.current) {
      suppressBubbleUntilUserFabPressRef.current = false;
      clearTypingTimers();
      if (pendingCardDockSpringRef.current) {
        return () => {
          clearTypingTimers();
        };
      }
      setBubbleHidden(false);
      bubbleDismiss.value = 0;
      bubbleProg.value = 0;
      bubbleProg.value = withDelay(
        CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS,
        withTiming(1, BUBBLE_FADE_IN_EASE),
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
      return () => {
        clearTypingTimers();
      };
    }

    const contentOnlyUpdate = softFromThinking || fabEntranceDoneRef.current;

    if (contentOnlyUpdate) {
      clearTypingTimers();
      if (pendingCardDockSpringRef.current) {
        return () => {
          clearTypingTimers();
        };
      }
      if (suppressBubbleUntilUserFabPressRef.current) {
        return () => {
          clearTypingTimers();
        };
      }
      setBubbleHidden(false);
      bubbleDismiss.value = 0;
      bubbleProg.value = 0;
      bubbleProg.value = withTiming(1, BUBBLE_FADE_IN_EASE);
      setTypedLen(0);
      setShowCaret(true);
      typingKickoffRef.current = setTimeout(() => {
        startTypingLoop();
        caretTimerRef.current = setInterval(() => {
          setShowCaret((c) => !c);
        }, CREATE_MEETING_AGENT_TYPING_CARET_BLINK_MS);
      }, CREATE_MEETING_AGENT_BUBBLE_FADE_IN_MS + CREATE_MEETING_AGENT_TYPING_LAG_AFTER_BUBBLE_MS);
      return () => {
        clearTypingTimers();
      };
    }

    btnTy.value = RISE_FROM;
    btnScale.value = 0.88;
    floorShadowP.value = 1;
    riseDone.value = 0;
    idleFloat.value = 0;
    bubbleProg.value = 0;
    clearTypingTimers();

    if (suppressBubbleUntilUserFabPressRef.current) {
      bubbleDismiss.value = 1;
      setBubbleHidden(true);
      setTypedLen(0);
      setShowCaret(true);
    } else {
      bubbleDismiss.value = 0;
      setBubbleHidden(false);
      setTypedLen(0);
      setShowCaret(true);

      bubbleProg.value = 0;
      bubbleProg.value = withDelay(
        CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS,
        withTiming(1, BUBBLE_FADE_IN_EASE),
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
    wizardStep,
  ]); // eslint-disable-line react-hooks/exhaustive-deps -- 문구·단계 변경 시 시퀀스 재생

  bubbleAfterDockRef.current = () => {
    clearTypingTimers();
    if (suppressBubbleUntilUserFabPressRef.current) {
      return;
    }
    setTypedLen(0);
    setShowCaret(true);
    setBubbleHidden(false);
    bubbleDismiss.value = 0;
    bubbleProg.value = 0;
    bubbleProg.value = withDelay(
      CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS,
      withTiming(1, BUBBLE_FADE_IN_EASE),
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
  };

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
    const idleMul = interpolate(
      fabMotionProfileSv.value,
      [0, 1],
      [FAB_MOTION_USER_IDLE_MUL, 1],
      Extrapolation.CLAMP,
    );
    const floatPart =
      (MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE + (f - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL) * idleMul;
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
    const idleMul = interpolate(
      fabMotionProfileSv.value,
      [0, 1],
      [FAB_MOTION_USER_IDLE_MUL, 1],
      Extrapolation.CLAMP,
    );
    const floatPart =
      (MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE + (f - 0.5) * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL) * idleMul;
    const scale = btnScale.value * (1 + (f - 0.5) * MEETING_CREATE_FAB_IDLE_BREATHE_MUL * idleMul);
    return {
      transform: [{ translateY: btnTy.value + floatPart }, { scale }],
    };
  });

  const bubbleStyle = useAnimatedStyle(() => {
    const p = bubbleProg.value;
    const baseO = interpolate(p, [0, 1], [0, 1], Extrapolation.CLAMP);
    const dismissMul = interpolate(bubbleDismiss.value, [0, 1], [1, 0], Extrapolation.CLAMP);
    return {
      opacity: baseO * dismissMul,
    };
  });

  const staticGlass = shouldUseStaticGlassInsteadOfBlur();

  const playAcceptAutopilotThenApply = useCallback(() => {
    if (acceptAutopilotBusyRef.current) return;
    acceptAutopilotBusyRef.current = true;
    setAgentFabMotionMode('auto');
    suppressBubbleUntilUserFabPressRef.current = true;
    runBubbleDismiss();
    runAcceptSuggestion();
    if (acceptAutopilotBusyClearTimerRef.current != null) {
      clearTimeout(acceptAutopilotBusyClearTimerRef.current);
    }
    acceptAutopilotBusyClearTimerRef.current = setTimeout(() => {
      acceptAutopilotBusyClearTimerRef.current = null;
      acceptAutopilotBusyRef.current = false;
    }, ACCEPT_AUTOPILOT_BUSY_CLEAR_MS);
  }, [runAcceptSuggestion, runBubbleDismiss]);

  useEffect(() => {
    if (wizardStep !== 1) {
      setAgentStep1InteractionUnlocked(false);
      return;
    }
    if (layoutMode === 'screenBottom' && fabEntranceDoneRef.current) {
      setAgentStep1InteractionUnlocked(true);
    }
  }, [wizardStep, layoutMode]);

  const onAiFabPress = useCallback(() => {
    if (bubbleHidden) {
      reopenAgentBubbleFromUserIntent();
    } else {
      suppressBubbleUntilUserFabPressRef.current = true;
      notifyCreateMeetingAgentBubbleDismiss();
    }
  }, [bubbleHidden, reopenAgentBubbleFromUserIntent]);

  const hasCardDockForLayout = layoutMode === 'cardTopRight' && cardDockPosition != null;

  const bubbleEl = (
    <Animated.View
      key="agent-bubble"
      style={[
        styles.bubbleWrap,
        {
          maxWidth: bubbleMaxW,
          minWidth: bubbleMinW,
          marginTop: FAB_CIRCLE_TOP_OFFSET_IN_STACK,
          alignSelf: 'flex-start',
        },
        bubbleStyle,
      ]}
      pointerEvents={bubbleHidden ? 'none' : 'box-none'}>
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
                onPress={() => playAcceptAutopilotThenApply()}
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
  );

  const fabEl = (
    <View
      key="agent-fab-stack"
      style={[styles.fabStack, { width: BTN_SIZE, height: FAB_STACK_H }]}
      pointerEvents="box-none">
      <View style={styles.floorShadowWrap} pointerEvents="none">
        <Animated.View style={[styles.floorShadowBlob, floorShadowStyle]} />
      </View>
      <Animated.View style={[styles.btnLift, btnStyle]}>
        <Pressable
          onPress={onAiFabPress}
          accessibilityRole="button"
          accessibilityLabel="모임 만들기 도우미 AI"
          style={styles.pressFill}>
          {({ pressed }) => <AiCircleButton pressed={pressed} />}
        </Pressable>
      </Animated.View>
    </View>
  );

  const dockRowW = bubbleMaxW + BTN_SIZE + 8;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.dock,
          hasCardDockForLayout && styles.dockCardTopRight,
          { width: dockRowW },
          dockCombinedStyle,
        ]}
        pointerEvents="box-none">
        <View style={[styles.fabBubbleRow, { width: dockRowW, maxWidth: dockRowW }]} pointerEvents="box-none">
          {bubbleEl}
          {fabEl}
        </View>
      </Animated.View>
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
  dockCardTopRight: {
    justifyContent: 'flex-start',
  },
  /** 말풍선 + FAB 가로 — 상단 정렬, 말풍선은 길어질 때 아래로만 성장 */
  fabBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    minHeight: FAB_STACK_H,
    alignSelf: 'flex-end',
    overflow: 'visible',
  },
  fabStack: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 1,
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
    flexShrink: 1,
    marginRight: 8,
    zIndex: 3,
  },

  bubbleClip: {
    alignSelf: 'stretch',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(56, 0, 70, 0.36)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  //jjg ai말풍선 배경 설정 
  bubbleStaticGlass: {
    backgroundColor: 'rgb(254, 250, 255)',
  },
  bubbleText: {
    flexShrink: 1,
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
