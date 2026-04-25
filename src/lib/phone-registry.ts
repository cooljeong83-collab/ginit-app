import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/src/lib/supabase';
import { getUserProfile, isUserProfileWithdrawn } from '@/src/lib/user-profile';

/** 로컬에 등록된 사용자 PK(전화 E.164 또는 이메일) 목록 — 오프라인 시 가입 여부 보조 */
const REGISTRY_KEY = 'ginit.phoneRegistry.v1';

async function readList(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

/** AsyncStorage 목록에 이미 있는지(가입 완료로 기록된 PK) */
export async function isPhoneRegisteredLocally(normalizedId: string): Promise<boolean> {
  const list = await readList();
  return list.includes(normalizedId);
}

async function hasActiveUserWithPhoneField(normalizedPhone: string): Promise<boolean> {
  const phone = normalizedPhone.trim();
  if (!phone) return false;
  try {
    const { data, error } = await supabase.rpc('has_profile_for_phone_e164', { p_phone: phone });
    if (error) return false;
    if (typeof data === 'boolean') return data;
    // 방어적 처리: rpc 결과가 예상과 다르면 최소 조회로 폴백
    const p = await getUserProfile(phone);
    return Boolean(p && !isUserProfileWithdrawn(p));
  } catch {
    return false;
  }
}

/**
 * 가입된 회원으로 본다: `users/{id}` 문서가 있고 탈퇴가 아니면 true.
 * `id`가 전화 E.164이면 레거시 문서(`users/{전화}`) 또는 `phone` 필드 일치 문서를 모두 고려합니다.
 * 오류 시 AsyncStorage 보조 목록을 쓰므로, 로그인/가입 **화면**의 전화 가입 여부는 `hasLoginableUserForPhoneE164`와 맞출 것.
 */
export async function isPhoneRegistered(id: string): Promise<boolean> {
  const trimmed = id.trim();
  if (!trimmed) return false;
  try {
    const p = await getUserProfile(trimmed);
    if (p && !isUserProfileWithdrawn(p)) return true;
    if (trimmed.startsWith('+') && (await hasActiveUserWithPhoneField(trimmed))) return true;
    return false;
  } catch {
    return await isPhoneRegisteredLocally(trimmed);
  }
}

/** 신규면 목록에 추가하고 `{ isNew: true }`, 이미 있으면 `{ isNew: false }` */
export async function registerPhoneIfNew(normalizedPhone: string): Promise<{ isNew: boolean }> {
  const list = await readList();
  if (list.includes(normalizedPhone)) {
    return { isNew: false };
  }
  list.push(normalizedPhone);
  await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(list));
  return { isNew: true };
}

/** 이메일 PK 가입 완료 시 전화·이메일을 모두 로컬 목록에 넣어 오프라인 부트를 돕습니다. */
export async function registerSignupLocalKeys(normalizedPhone: string, userIdEmail: string): Promise<void> {
  const list = await readList();
  const next = new Set(list);
  const p = normalizedPhone.trim();
  const e = userIdEmail.trim();
  if (p) next.add(p);
  if (e) next.add(e);
  await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify([...next]));
}

/** 탈퇴 등: 로컬 가입 PK 목록에서 제거합니다. */
export async function removePhoneFromRegistry(normalizedPhone: string): Promise<void> {
  const id = normalizedPhone.trim();
  if (!id) return;
  const list = await readList();
  const next = list.filter((x) => x !== id);
  await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
}
