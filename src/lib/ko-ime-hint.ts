import { NativeModules, Platform } from 'react-native';

type KoImeHintNative = { hintKoreanForFocusedInput?: () => void };

const native: KoImeHintNative | undefined =
  Platform.OS === 'android' ? (NativeModules.KoImeHint as KoImeHintNative | undefined) : undefined;

/** Android: 포커스된 EditText에 한국어 IME 힌트 적용(API 24+, 키보드 앱이 힌트를 따를 때만). */
export function hintKoreanImeForFocusedInput(): void {
  try {
    native?.hintKoreanForFocusedInput?.();
  } catch {
    /* noop */
  }
}
