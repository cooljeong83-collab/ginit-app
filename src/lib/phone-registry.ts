import AsyncStorage from '@react-native-async-storage/async-storage';

import { getUserProfile, isUserProfileWithdrawn } from '@/src/lib/user-profile';

/** 로컬에 등록된 전화 PK 목록 (서버 대체 — 보안 가이드상 기기 번호 기반 자동 가입) */
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

/** AsyncStorage 목록에 이미 있는지(가입 완료로 기록된 번호) */
export async function isPhoneRegisteredLocally(normalizedPhone: string): Promise<boolean> {
  const list = await readList();
  return list.includes(normalizedPhone);
}

/**
 * 가입된 회원으로 본다: 로컬 등록 목록 또는 Firestore `users/{전화}` 문서 존재.
 */
export async function isPhoneRegistered(normalizedPhone: string): Promise<boolean> {
  const id = normalizedPhone.trim();
  if (!id) return false;
  try {
    const locally = await isPhoneRegisteredLocally(id);
    const p = await getUserProfile(id);
    if (!p) return false;
    // 탈퇴 계정은 "가입된 회원"으로 취급하지 않아야 로그인 화면에서 시작합니다.
    return !isUserProfileWithdrawn(p);
  } catch {
    // 네트워크가 불안정해 서버 확인이 불가하면 로컬 등록 여부로만 판단합니다.
    // (단, 서버에서 탈퇴된 계정은 online 시 즉시 login으로 돌아오게 됩니다.)
    return await isPhoneRegisteredLocally(id);
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

/** 탈퇴 등: 로컬 가입 번호 목록에서 제거합니다. */
export async function removePhoneFromRegistry(normalizedPhone: string): Promise<void> {
  const id = normalizedPhone.trim();
  if (!id) return;
  const list = await readList();
  const next = list.filter((x) => x !== id);
  await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(next));
}
