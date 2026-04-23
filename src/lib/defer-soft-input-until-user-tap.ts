import type { RefObject } from 'react';
import { Platform, type TextInput, type TextInputProps } from 'react-native';

type Merge = Pick<TextInputProps, 'onBlur' | 'onFocus' | 'onPressIn'>;

/**
 * 약속 잡기 등: `ref.focus()`로만 포커스를 줄 때는 키보드를 올리지 않고,
 * 사용자가 해당 필드를 직접 눌렀을 때만 소프트 키보드를 띄웁니다.
 * (Android·iOS 네이티브 — 웹은 그대로 두고 선택적 `onFocus`/`onBlur`만 전달합니다.)
 */
export function deferSoftInputUntilUserTapProps(
  inputRef: RefObject<TextInput | null>,
  merge?: Merge,
): Pick<TextInputProps, 'showSoftInputOnFocus' | 'onPressIn' | 'onBlur' | 'onFocus'> {
  if (Platform.OS === 'web') {
    return {
      onFocus: merge?.onFocus,
      onBlur: merge?.onBlur,
      onPressIn: merge?.onPressIn,
    };
  }
  return {
    showSoftInputOnFocus: false,
    onPressIn: (e) => {
      inputRef.current?.setNativeProps?.({ showSoftInputOnFocus: true });
      merge?.onPressIn?.(e);
    },
    onBlur: (e) => {
      inputRef.current?.setNativeProps?.({ showSoftInputOnFocus: false });
      merge?.onBlur?.(e);
    },
    onFocus: merge?.onFocus,
  };
}
