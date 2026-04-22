import { InteractionManager, Platform, type TextInput } from 'react-native';
import { useEffect, type RefObject } from 'react';

/**
 * 스텝 진입 직후 특정 TextInput에 포커스를 주는 공통 훅.
 * (키보드/레이아웃 반영 후 포커스를 줘야 스크롤 튐이 줄어듭니다.)
 */
export function useAutoFocusOnStep(opts: {
  enabled: boolean;
  targetRef: RefObject<TextInput | null>;
  delayMs?: { android: number; ios: number };
}) {
  const { enabled, targetRef, delayMs = { android: 120, ios: 60 } } = opts;

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        targetRef.current?.focus?.();
      });
    }, Platform.OS === 'android' ? delayMs.android : delayMs.ios);
    return () => clearTimeout(t);
  }, [delayMs.android, delayMs.ios, enabled, targetRef]);
}

