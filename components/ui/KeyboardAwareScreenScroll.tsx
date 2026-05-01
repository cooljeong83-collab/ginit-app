import { forwardRef, useCallback, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Keyboard } from 'react-native';
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
  /**
   * `contentContainerStyle`에 `flexGrow: 1`을 합칩니다(기본 true).
   * 모달 등 짧은 폼에서 스크롤 여백이 필요하면 false로 두고 `paddingBottom`으로 슬랙을 주세요.
   */
  contentContainerFlexGrow?: boolean;
  /** 탭바 안 스크린일 때 true(기본). 모달·풀스크린 폼은 false 권장. */
  viewIsInsideTabBar?: boolean;
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
  /** 스크롤을 시작하면 키보드를 내립니다(드래그 dismiss와 함께 쓰기 좋음). */
  dismissKeyboardOnScrollBeginDrag?: boolean;
};

export const KeyboardAwareScreenScroll = forwardRef<KeyboardAwareScrollView, KeyboardAwareScreenScrollProps>(
function KeyboardAwareScreenScroll(
{
  children,
  style,
  contentContainerStyle,
  contentContainerFlexGrow = true,
  viewIsInsideTabBar = true,
  extraScrollHeight,
  extraHeight,
  scrollProps,
  dismissKeyboardOnScrollBeginDrag,
}: KeyboardAwareScreenScrollProps,
  ref,
) {
  const insets = useSafeAreaInsets();

  const resolvedExtraScrollHeight = extraScrollHeight ?? 12;
  const resolvedExtraHeight = extraHeight ?? Math.max(0, insets.bottom) + 24;

  const onScrollBeginDragMerged = useCallback(
    (e: Parameters<NonNullable<KeyboardAwareScrollViewProps['onScrollBeginDrag']>>[0]) => {
      if (dismissKeyboardOnScrollBeginDrag) {
        Keyboard.dismiss();
      }
      scrollProps?.onScrollBeginDrag?.(e);
    },
    [dismissKeyboardOnScrollBeginDrag, scrollProps],
  );

  const mergedContentContainerStyle = useMemo(() => {
    return [
      contentContainerFlexGrow ? { flexGrow: 1 } : null,
      contentContainerStyle,
    ].filter(Boolean) as StyleProp<ViewStyle>;
  }, [contentContainerFlexGrow, contentContainerStyle]);

  return (
    <KeyboardAwareScrollView
      ref={ref}
      style={style}
      contentContainerStyle={mergedContentContainerStyle}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      enableOnAndroid
      enableAutomaticScroll
      enableResetScrollToCoords
      extraScrollHeight={resolvedExtraScrollHeight}
      extraHeight={resolvedExtraHeight}
      viewIsInsideTabBar={viewIsInsideTabBar}
      keyboardOpeningTime={250}
      {...scrollProps}
      onScrollBeginDrag={onScrollBeginDragMerged}>
      {children}
    </KeyboardAwareScrollView>
  );
},
);

