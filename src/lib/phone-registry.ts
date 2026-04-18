import AsyncStorage from '@react-native-async-storage/async-storage';

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
