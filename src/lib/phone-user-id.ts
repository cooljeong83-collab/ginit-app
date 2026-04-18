import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage + 앱 전역에서 쓰는 전화번호 기반 사용자 PK (정규화된 문자열, 예: +821012345678) */
export const PHONE_USER_ID_STORAGE_KEY = 'ginit.phoneUserId.v1';

/**
 * 한국 번호 위주 정규화. 숫자만 추출 후 10~11자리 로컬(0으로 시작) 또는 이미 82 포함 시 +82… 형태로 반환.
 * 유효하지 않으면 null.
 */
/** 정규화된 번호(+8210…)를 흔한 표기 `010-1234-5678` 형태로 보여줍니다. */
export function formatNormalizedPhoneKrDisplay(normalized: string): string {
  const n = normalized.trim();
  if (!n.startsWith('+82')) return n;
  const body = n.slice(3);
  const localDigits = body.startsWith('10') ? `0${body}` : `0${body}`;
  const d = localDigits.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}

export function normalizePhoneUserId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let d = trimmed.replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) return null;
  if (d.startsWith('82')) {
    return `+${d}`;
  }
  if (d.startsWith('0')) {
    return `+82${d.slice(1)}`;
  }
  if (d.length >= 10 && d.length <= 11 && !d.startsWith('0')) {
    return `+82${d}`;
  }
  return null;
}

export async function readStoredPhoneUserId(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(PHONE_USER_ID_STORAGE_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export async function writeStoredPhoneUserId(phoneUserId: string): Promise<void> {
  await AsyncStorage.setItem(PHONE_USER_ID_STORAGE_KEY, phoneUserId);
}

export async function clearStoredPhoneUserId(): Promise<void> {
  await AsyncStorage.removeItem(PHONE_USER_ID_STORAGE_KEY);
}
