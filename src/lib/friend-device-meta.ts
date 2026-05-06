/**
 * 친구 **표시 별칭**·**상대 메모**·**즐겨찾기** — `friends-privacy-local`(숨김/차단)과 동일하게 **기기 로컬(AsyncStorage)만** 사용합니다.
 * 서버·다른 기기와 동기화가 필요하면 이후 `public` 스키마 테이블 + RLS·`security definer` RPC(Supabase)로 이전하는 것을 권장합니다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { friendPeerStorageKey } from '@/src/lib/friends-privacy-local';

function aliasesStorageKey(meCanon: string): string {
  return `ginit.friend.display_alias.v1:${friendPeerStorageKey(meCanon)}`;
}

function favoritesStorageKey(meCanon: string): string {
  return `ginit.friend.favorite_peers.v1:${friendPeerStorageKey(meCanon)}`;
}

function peerMemosStorageKey(meCanon: string): string {
  return `ginit.friend.peer_memo.v1:${friendPeerStorageKey(meCanon)}`;
}

function parseAliasRecord(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const kk = friendPeerStorageKey(k);
      if (!kk) continue;
      if (typeof v === 'string' && v.trim()) out[kk] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadFriendDisplayAliases(meCanon: string): Promise<Record<string, string>> {
  const me = friendPeerStorageKey(meCanon);
  if (!me) return {};
  const raw = await AsyncStorage.getItem(aliasesStorageKey(me));
  return parseAliasRecord(raw);
}

export async function saveFriendDisplayAlias(meCanon: string, peerRaw: string, alias: string): Promise<void> {
  const me = friendPeerStorageKey(meCanon);
  const peer = friendPeerStorageKey(peerRaw);
  if (!me || !peer) return;
  const next = await loadFriendDisplayAliases(me);
  const t = alias.trim();
  if (!t) delete next[peer];
  else next[peer] = t;
  await AsyncStorage.setItem(aliasesStorageKey(me), JSON.stringify(next));
}

export function friendDisplayName(aliases: Record<string, string>, peerRaw: string, officialNickname: string): string {
  const peer = friendPeerStorageKey(peerRaw);
  const a = peer ? aliases[peer]?.trim() : '';
  const o = officialNickname.trim();
  return a || o || '회원';
}

export async function loadFriendPeerMemos(meCanon: string): Promise<Record<string, string>> {
  const me = friendPeerStorageKey(meCanon);
  if (!me) return {};
  const raw = await AsyncStorage.getItem(peerMemosStorageKey(me));
  return parseAliasRecord(raw);
}

export async function saveFriendPeerMemo(meCanon: string, peerRaw: string, memo: string): Promise<void> {
  const me = friendPeerStorageKey(meCanon);
  const peer = friendPeerStorageKey(peerRaw);
  if (!me || !peer) return;
  const next = await loadFriendPeerMemos(me);
  const t = memo.trim();
  if (!t) delete next[peer];
  else next[peer] = t;
  await AsyncStorage.setItem(peerMemosStorageKey(me), JSON.stringify(next));
}

export function friendPeerMemo(memos: Record<string, string>, peerRaw: string): string {
  const peer = friendPeerStorageKey(peerRaw);
  return peer ? (memos[peer]?.trim() ?? '') : '';
}

export async function loadFavoritePeerKeys(meCanon: string): Promise<Set<string>> {
  const me = friendPeerStorageKey(meCanon);
  if (!me) return new Set();
  const raw = await AsyncStorage.getItem(favoritesStorageKey(me));
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => friendPeerStorageKey(x)),
    );
  } catch {
    return new Set();
  }
}

export async function saveFavoritePeerKeys(meCanon: string, keys: Set<string>): Promise<void> {
  const me = friendPeerStorageKey(meCanon);
  if (!me) return;
  await AsyncStorage.setItem(favoritesStorageKey(me), JSON.stringify([...keys]));
}

/** @returns 즐겨찾기 여부(토글 후) */
export async function toggleFavoritePeer(meCanon: string, peerRaw: string): Promise<boolean> {
  const peer = friendPeerStorageKey(peerRaw);
  if (!peer) return false;
  const s = await loadFavoritePeerKeys(meCanon);
  if (s.has(peer)) {
    s.delete(peer);
    await saveFavoritePeerKeys(meCanon, s);
    return false;
  }
  s.add(peer);
  await saveFavoritePeerKeys(meCanon, s);
  return true;
}
