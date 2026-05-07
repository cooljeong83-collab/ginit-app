import { forwardRef, useCallback, useMemo } from 'react';
import type { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import { Keyboard } from 'react-native';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DEPRECATED_SCROLL_KEYS = new Set([
  'enableAutomaticScroll',
  'enableResetScrollToCoords',
  'enableOnAndroid',
  'viewIsInsideTabBar',
  'keyboardOpeningTime',
]);

/** 구 `keyboard-aware-scroll-view` 전용 키 — 전달되면 래퍼에서 제거 후 나머지만 ScrollView로 넘김 */
export type LegacyKeyboardAwareScrollExtras = {
  keyboardOpeningTime?: number;
  enableAutomaticScroll?: boolean;
  enableResetScrollToCoords?: boolean;
  enableOnAndroid?: boolean;
  viewIsInsideTabBar?: boolean;
};

/**
 * 앱 공통: 키보드에 가리는 입력칸 자동 스크롤 스크린 래퍼.
 * `react-native-keyboard-controller`의 KeyboardAwareScrollView 기반.
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
  /** 호환용 prop — 신규 라이브러리에서는 미사용 */
  viewIsInsideTabBar?: boolean;
  /** 키보드와 포커스 입력 사이 여백에 대응 → `bottomOffset` */
  extraScrollHeight?: number;
  /** 리스트 하단 추가 공간에 대응 → `extraKeyboardSpace` */
  extraHeight?: number;
  /** ScrollView에 그대로 전달(구 라이브러리 전용 키는 런타임에서 제거) */
  scrollProps?: ScrollViewProps & LegacyKeyboardAwareScrollExtras;
  /** 스크롤을 시작하면 키보드를 내립니다(드래그 dismiss와 함께 쓰기 좋음). */
  dismissKeyboardOnScrollBeginDrag?: boolean;
};

export const KeyboardAwareScreenScroll = forwardRef<
  React.ElementRef<typeof KeyboardAwareScrollView>,
  KeyboardAwareScreenScrollProps
>(function KeyboardAwareScreenScroll(
  {
    children,
    style,
    contentContainerStyle,
    contentContainerFlexGrow = true,
    extraScrollHeight,
    extraHeight,
    scrollProps,
    dismissKeyboardOnScrollBeginDrag,
  },
  ref,
) {
  const insets = useSafeAreaInsets();

  const resolvedBottomOffset = extraScrollHeight ?? 12;
  const resolvedExtraKeyboardSpace = extraHeight ?? Math.max(0, insets.bottom) + 24;

  const sanitizedScrollProps = useMemo(() => {
    if (!scrollProps) return {} as KeyboardAwareScrollViewProps;
    const raw = { ...scrollProps } as Record<string, unknown>;
    for (const k of DEPRECATED_SCROLL_KEYS) {
      delete raw[k];
    }
    return raw as KeyboardAwareScrollViewProps;
  }, [scrollProps]);

  const onScrollBeginDragMerged = useCallback(
    (e: Parameters<NonNullable<ScrollViewProps['onScrollBeginDrag']>>[0]) => {
      if (dismissKeyboardOnScrollBeginDrag) {
        Keyboard.dismiss();
      }
      sanitizedScrollProps.onScrollBeginDrag?.(e);
    },
    [dismissKeyboardOnScrollBeginDrag, sanitizedScrollProps],
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
      bottomOffset={resolvedBottomOffset}
      extraKeyboardSpace={resolvedExtraKeyboardSpace}
      {...sanitizedScrollProps}
      onScrollBeginDrag={onScrollBeginDragMerged}>
      {children}
    </KeyboardAwareScrollView>
  );
});
