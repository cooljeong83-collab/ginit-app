import { GinitTheme } from '@/constants/ginit-theme';
import { Platform } from 'react-native';

type DateTimePickerDisplay = 'default' | 'spinner' | 'clock' | 'compact' | 'calendar' | 'inline';

export const GINIT_TIME_PICKER_ACCENT = GinitTheme.colors.deepPurple;

/** `mode="time"` — Android: 시계 다이얼, iOS: 시스템 권장 스타일 */
export function timePickerDisplay(): DateTimePickerDisplay {
  if (Platform.OS === 'android') return 'clock';
  return 'default';
}

/**
 * 네이티브 시간 피커 UI — 12시간 + 오전/오후.
 * `onChange`의 `Date` → `fmtTimeHm` / `hmFromDateLocal`로 저장·화면 표기 시 24시간(`HH:mm`) 유지.
 */
export function timePickerIs24Hour(): boolean {
  return false;
}

export function timePickerLocale(): string {
  return 'ko-KR';
}

/** `mode="time"` DateTimePicker 공통 props */
export function timePickerNativeProps(): Record<string, unknown> {
  return {
    display: timePickerDisplay(),
    is24Hour: timePickerIs24Hour(),
    locale: timePickerLocale(),
    ...timePickerThemeProps(),
    ...timePickerAndroidDesignProps(),
  };
}

/** `mode="date"` — 기존 스피너 유지 */
export function datePickerDisplay(): DateTimePickerDisplay {
  return 'spinner';
}

/**
 * iOS 전용 강조색. Android 시계/달력 색은 `app.config.ts`의
 * `@react-native-community/datetimepicker` config plugin(빌드 시)으로 지정합니다.
 */
export function timePickerThemeProps(): Record<string, unknown> {
  return Platform.select({
    ios: {
      accentColor: GINIT_TIME_PICKER_ACCENT,
      themeVariant: 'light' as const,
    },
    default: {},
  })!;
}

/**
 * Android 기본(TimePickerDialog) 피커 — `app.config.ts` datetimepicker plugin이
 * `TimePickerTheme`/`DatePickerDialogTheme` 색을 네이티브에 주입합니다.
 *
 * `design: 'material'`(MaterialTimePicker)은 `AppTheme`이
 * `Theme.Material3.DayNight.NoActionBar`일 때만 사용 가능합니다. AppCompat 테마에서는
 * MaterialTimePicker가 colorPrimary 등을 resolve하지 못해 크래시합니다.
 */
export function timePickerAndroidDesignProps(): Record<string, unknown> {
  return {};
}

export type NativePickerChangeType = 'set' | 'dismissed' | 'neutralButtonPressed' | string;

export function nativePickerEventType(event: { type?: string } | null | undefined): string {
  return String(event?.type ?? '').trim();
}

export function isNativePickerDismiss(type: string): boolean {
  return type === 'dismissed' || type === 'neutralButtonPressed';
}
