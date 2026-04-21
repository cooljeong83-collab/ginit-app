import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

/** 앱 내부 사용자 PK — 신규는 정규화된 이메일, 레거시는 전화 E.164(+82…) */
export const USER_ID_STORAGE_KEY = 'ginit.userId.v1';

/** @deprecated 레거시 키(전화 PK). 읽기 시 마이그레이션용 */
const LEGACY_PHONE_USER_ID_STORAGE_KEY = 'ginit.phoneUserId.v1';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Firestore `users/{id}` 및 세션에 쓰는 사용자 ID.
 * - 이메일: trim + 소문자
 * - 그 외(레거시 전화 등): 그대로 trim
 */
export function normalizeUserId(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.includes('@')) {
    const lower = t.toLowerCase();
    return EMAIL_RE.test(lower) ? lower : null;
  }
  return t;
}

/**
 * 모임 `participantIds` / `createdBy` / 채팅 `senderId` 등에 공통 적용.
 * - 이메일 형태면 `normalizeUserId`
 * - 아니면 전화번호면 `normalizePhoneUserId`, 그 외는 trim
 */
export function normalizeParticipantId(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (t.includes('@')) return normalizeUserId(t) ?? t.toLowerCase().trim();
  const phone = normalizePhoneUserId(t);
  if (phone) return phone;
  return t;
}

export async function readStoredUserId(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(USER_ID_STORAGE_KEY);
    if (v?.trim()) return v.trim();
    const legacy = await AsyncStorage.getItem(LEGACY_PHONE_USER_ID_STORAGE_KEY);
    return legacy?.trim() || null;
  } catch {
    return null;
  }
}

export async function writeStoredUserId(userId: string): Promise<void> {
  await AsyncStorage.setItem(USER_ID_STORAGE_KEY, userId.trim());
}

export async function clearStoredUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_ID_STORAGE_KEY);
  } catch {
    /* noop */
  }
  try {
    await AsyncStorage.removeItem(LEGACY_PHONE_USER_ID_STORAGE_KEY);
  } catch {
    /* noop */
  }
}
