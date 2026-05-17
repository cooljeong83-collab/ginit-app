import { memo } from 'react';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** `KeyboardGestureArea` ↔ composer `TextInput` 연결 */
export const GINIT_CHAT_COMPOSER_NATIVE_ID = 'ginit-chat-composer';

/** safe area ↔ 입력창 간격(공식 예제 MARGIN) */
export const CHAT_KEYBOARD_BOTTOM_OFFSET = 8;

/** inverted + 키보드 애니 중 셀 플래시 완화 */
export const CHAT_FLASH_LIST_DRAW_DISTANCE = 480;

type UseChatComposerStickyOffsetResult = {
  stickyOpenedOffset: number;
};

export function useChatComposerStickyOffset(): UseChatComposerStickyOffsetResult {
  const { bottom } = useSafeAreaInsets();
  return {
    stickyOpenedOffset: Math.max(0, bottom - CHAT_KEYBOARD_BOTTOM_OFFSET),
  };
}

/**
 * inverted FlashList: `ListHeaderComponent`가 시각적 하단(최신 말풍선 아래)에 붙습니다.
 * `contentContainerStyle.paddingTop`(입력 독) + 이 스페이서(키보드)로 말풍선을 키보드와 같이 올립니다.
 */
export const ChatInvertedKeyboardSpacer = memo(function ChatInvertedKeyboardSpacer() {
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => {
    // reanimated height: 키보드 열림 시 음수 → 양수 lift (worklet 내부만 사용)
    const lift = -keyboardHeight.value;
    return {
      height: lift > 0 ? lift : 0,
    };
  });

  return <Animated.View style={style} />;
});
