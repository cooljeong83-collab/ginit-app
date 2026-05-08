import { forwardRef, useCallback, useRef, type ElementRef } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import type { GestureResponderEvent } from 'react-native';

export type GinitPressableProps = PressableProps & {
  /**
   * true면 `onPress`에 900ms 중복 방지를 적용하지 않습니다.
   * (이미지 전체보기 모달·줌 제스처가 있는 영역 등)
   */
  duplicatePressGuardDisabled?: boolean;
};

/**
 * 모임 목록(`meetingOpenLockRef`)과 동일: `onPress`가 900ms 안에 두 번 이상 호출되지 않게 합니다.
 * 이미지 뷰어 등은 `duplicatePressGuardDisabled`로 예외 처리하세요.
 */
export const GinitPressable = forwardRef<ElementRef<typeof Pressable>, GinitPressableProps>(
  function GinitPressable({ onPress, duplicatePressGuardDisabled, ...rest }, ref) {
    const openLockRef = useRef(false);
    const wrappedOnPress = useCallback(
      (e: GestureResponderEvent) => {
        if (!onPress) return;
        if (duplicatePressGuardDisabled) {
          onPress(e);
          return;
        }
        if (openLockRef.current) return;
        openLockRef.current = true;
        const lockRelease = () => {
          openLockRef.current = false;
        };
        // 네비게이션이 끝나기 전 더블탭으로 onPress가 2번 호출되는 케이스 방지
        setTimeout(lockRelease, 900);
        onPress(e);
      },
      [onPress, duplicatePressGuardDisabled],
    );

    return <Pressable ref={ref} {...rest} onPress={onPress ? wrappedOnPress : undefined} />;
  },
);
