import { forwardRef, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-aware-scroll-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * 앱 공통: 키보드에 가리는 입력칸 자동 스크롤 스크린 래퍼.
 *
 * - ScrollView 기반 폼 화면에 사용
 * - iOS/Android 모두에서 포커스된 TextInput이 키보드 뒤로 숨으면 자동 scrollTo
 */
export type KeyboardAwareScreenScrollProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** 추가로 위로 밀어올릴 여백(px). 플로팅 CTA/탭바가 있으면 늘리세요. */
  extraScrollHeight?: number;
  /** 키보드가 열릴 때의 스크롤 보정 높이(px). */
  extraHeight?: number;
  /** KeyboardAwareScrollView에 그대로 전달할 추가 props */
  scrollProps?: Omit<
    KeyboardAwareScrollViewProps,
    | 'children'
    | 'style'
    | 'contentContainerStyle'
    | 'extraScrollHeight'
    | 'extraHeight'
  >;
};

export const KeyboardAwareScreenScroll = forwardRef<KeyboardAwareScrollView, KeyboardAwareScreenScrollProps>(
function KeyboardAwareScreenScroll(
{
  children,
  style,
  contentContainerStyle,
  extraScrollHeight,
  extraHeight,
  scrollProps,
}: KeyboardAwareScreenScrollProps,
  ref,
) {
  const insets = useSafeAreaInsets();

  const resolvedExtraScrollHeight = extraScrollHeight ?? 12;
  const resolvedExtraHeight = extraHeight ?? Math.max(0, insets.bottom) + 24;

  const mergedContentContainerStyle = useMemo(() => {
    return [
      {
        flexGrow: 1,
      },
      contentContainerStyle,
    ] as StyleProp<ViewStyle>;
  }, [contentContainerStyle]);

  return (
    <KeyboardAwareScrollView
      ref={ref}
      style={style}
      contentContainerStyle={mergedContentContainerStyle}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      enableOnAndroid
      enableResetScrollToCoords
      extraScrollHeight={resolvedExtraScrollHeight}
      extraHeight={resolvedExtraHeight}
      // iOS에서 내비게이션/세이프에어리어 고려
      viewIsInsideTabBar
      keyboardOpeningTime={250}
      {...scrollProps}>
      {children}
    </KeyboardAwareScrollView>
  );
},
);

