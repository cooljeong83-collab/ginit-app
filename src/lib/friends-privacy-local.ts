import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeParticipantId } from '@/src/lib/app-user-id';

/** 친구/차단/숨김 저장용 peer 키 정규화 */
export function friendPeerStorageKey(raw: string | null | undefined): string {
  const t = raw?.trim() ?? '';
  return t ? normalizeParticipantId(t) : '';
}

export function friendsHiddenStorageKey(me: string): string {
  return `ginit.friends.hidden.v1:${me.trim()}`;
}

export function friendsBlockedPeerIdsStorageKey(me: string): string {
  return `ginit.friends.blocked_peer_ids.v1:${me.trim()}`;
}

export function friendsAutoAddContactsStorageKey(me: string): string {
  return `ginit.friends.auto_add_contacts.v1:${me.trim()}`;
}

export function friendsAllowRecommendationsStorageKey(me: string): string {
  return `ginit.friends.allow_recommendations.v1:${me.trim()}`;
}

function parsePeerIdArrayJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => friendPeerStorageKey(x))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function loadHiddenPeerIds(me: string): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(friendsHiddenStorageKey(me));
  return new Set(parsePeerIdArrayJson(raw));
}

export async function saveHiddenPeerIds(me: string, ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(friendsHiddenStorageKey(me), JSON.stringify([...ids]));
}

export async function loadBlockedPeerIds(me: string): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(friendsBlockedPeerIdsStorageKey(me));
  return new Set(parsePeerIdArrayJson(raw));
}

export async function saveBlockedPeerIds(me: string, ids: Set<string>): Promise<void> {
  await AsyncStorage.setItem(friendsBlockedPeerIdsStorageKey(me), JSON.stringify([...ids]));
}

export async function loadFriendBoolPref(
  me: string,
  keyFn: (m: string) => string,
  defaultValue: boolean,
): Promise<boolean> {
  const raw = await AsyncStorage.getItem(keyFn(me));
  if (raw == null) return defaultValue;
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'boolean' ? v : defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function saveFriendBoolPref(me: string, keyFn: (m: string) => string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(keyFn(me), JSON.stringify(value));
}
