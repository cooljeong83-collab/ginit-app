import { Platform } from 'react-native';

import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

/** Expo Go·시뮬레이터 등에서 SIM을 못 읽을 때 쓰는 테스트용 로컬 번호(숫자만). */
export const DEV_FALLBACK_PHONE_RAW = '01000000000';

export type DeviceSimPhoneHint = 'permission_denied' | 'unavailable' | 'web';

export type DeviceSimPhoneResult = {
  normalized: string;
  raw: string;
  fromDevice: boolean;
  usedFallback: boolean;
  hint?: DeviceSimPhoneHint;
};

/**
 * 기기(SIM) 전화번호 읽기 — 긴급 안전 모드: `react-native-device-info` 로드·호출 없이 항상 fallback만 반환합니다.
 * // const DeviceInfo = require('react-native-device-info');
 * // await DeviceInfo.getPhoneNumber()
 */
export async function fetchDeviceSimPhoneNumber(): Promise<DeviceSimPhoneResult> {
  const fallbackNorm = normalizePhoneUserId(DEV_FALLBACK_PHONE_RAW);
  if (!fallbackNorm) {
    throw new Error('[device-sim-phone] DEV_FALLBACK_PHONE_RAW must be normalizable');
  }

  if (Platform.OS === 'web') {
    return {
      normalized: fallbackNorm,
      raw: DEV_FALLBACK_PHONE_RAW,
      fromDevice: false,
      usedFallback: true,
      hint: 'web',
    };
  }

  return {
    normalized: fallbackNorm,
    raw: DEV_FALLBACK_PHONE_RAW,
    fromDevice: false,
    usedFallback: true,
    hint: 'unavailable',
  };
}
