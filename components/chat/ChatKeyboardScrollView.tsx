import { memo, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import {
  AndroidSoftInputModes,
  KeyboardController,
  useKeyboardContext,
} from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** `KeyboardGestureArea` ↔ composer `TextInput` 연결 */
export const GINIT_CHAT_COMPOSER_NATIVE_ID = 'ginit-chat-composer';

/** safe area ↔ 입력창 간격(공식 예제 MARGIN) */
export const CHAT_KEYBOARD_BOTTOM_OFFSET = 8;

/** inverted + 키보드 애니 중 셀 플래시 완화 */
export const CHAT_FLASH_LIST_DRAW_DISTANCE = 480;

export type ChatComposerStickyOffset = {
  closed: number;
  opened: number;
};

/**
 * `KeyboardStickyView`용 reanimated 키보드 값.
 * `useReanimatedKeyboardAnimation`은 Android `adjustResize`를 켜 edge-to-edge와 충돌할 수 있어 사용하지 않습니다.
 */
export function useChatReanimatedKeyboardAnimation() {
  return useKeyboardContext().reanimated;
}

/**
 * `KeyboardStickyView`는 레이아웃 리사이즈 없이 translate만 합니다.
 * edge-to-edge Android에서는 `adjustResize`가 사실상 무효이므로 `adjustNothing`으로 두고 sticky 이동만 사용합니다.
 */
export function useChatAndroidStickyComposerInputMode() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => {
      KeyboardController.setDefaultMode();
    };
  }, []);
}

/** composer dock 하단 패딩 — safe area는 `KeyboardStickyView` offset.closed가 담당 */
export function getChatComposerBottomPadding(): number {
  return CHAT_KEYBOARD_BOTTOM_OFFSET;
}

/** `KeyboardStickyView` offset.closed가 올리는 거리(translate는 레이아웃에 반영되지 않음) */
export function getChatComposerStickyClosedLift(safeAreaBottom: number): number {
  return Math.max(0, safeAreaBottom - CHAT_KEYBOARD_BOTTOM_OFFSET);
}

/** inverted FlashList 시각 하단 여백 — 입력 독 높이만(네비·키보드 lift는 `ChatInvertedKeyboardSpacer`) */
export function getChatListVisualBottomPadding(
  composerDockBlockHeight: number,
  composerInputBarHeight: number,
  composerBottomPad: number,
): number {
  const dockPad = Math.max(composerDockBlockHeight, composerInputBarHeight + composerBottomPad);
  return Math.max(4, dockPad);
}

/**
 * edge-to-edge + absolute `KeyboardStickyView` 권장 패턴:
 * 키보드 닫힘 → safe-area만큼 위로, 열림 → 키보드 높이만큼 추가 이동(opened 추가 오프셋 없음).
 */
export function useChatComposerStickyOffset(): ChatComposerStickyOffset {
  const { bottom } = useSafeAreaInsets();
  return useMemo(
    () => ({
      closed: -getChatComposerStickyClosedLift(bottom),
      opened: 0,
    }),
    [bottom],
  );
}

/**
 * inverted FlashList: `ListHeaderComponent`가 시각적 하단(최신 말풍선 아래)에 붙습니다.
 * 키보드 높이 + (닫힘 시) sticky safe-area lift를 progress로 보간해, 키보드 내려가는 중에도 말풍선이 가려지지 않게 합니다.
 */
export const ChatInvertedKeyboardSpacer = memo(function ChatInvertedKeyboardSpacer() {
  const { height: keyboardHeight, progress } = useChatReanimatedKeyboardAnimation();
  const { bottom: safeAreaBottom } = useSafeAreaInsets();
  const stickyClosedLift = getChatComposerStickyClosedLift(safeAreaBottom);

  const style = useAnimatedStyle(() => {
    const keyboardLift = Math.max(0, -keyboardHeight.value);
    const stickyLift = stickyClosedLift * (1 - progress.value);
    return {
      height: keyboardLift + stickyLift,
    };
  }, [stickyClosedLift]);

  return <Animated.View style={style} />;
});
