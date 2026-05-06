import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { supabase } from '@/src/lib/supabase';

type UserBlocksListRow = {
  blocked_app_user_id?: string;
  created_at?: string;
};

function canonAppUserId(raw: string): string {
  return normalizeParticipantId(raw.trim());
}

function parseJsonbArray<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data as T[];
}

export async function fetchBlockedPeerIds(meAppUserId: string): Promise<Set<string>> {
  const me = canonAppUserId(meAppUserId);
  if (!me) return new Set();
  const { data, error } = await supabase.rpc('user_blocks_list', { p_me: me });
  if (error) throw new Error(error.message);
  const rows = parseJsonbArray<UserBlocksListRow>(data);
  const out = new Set<string>();
  for (const r of rows) {
    const id = typeof r?.blocked_app_user_id === 'string' ? canonAppUserId(r.blocked_app_user_id) : '';
    if (id) out.add(id);
  }
  return out;
}

export async function blockPeerServerSynced(meAppUserId: string, peerAppUserId: string): Promise<void> {
  const me = canonAppUserId(meAppUserId);
  const peer = canonAppUserId(peerAppUserId);
  if (!me || !peer || me === peer) return;
  const { error } = await supabase.rpc('user_blocks_block', { p_me: me, p_peer: peer });
  if (error) throw new Error(error.message);
}

export async function unblockPeerServerSynced(meAppUserId: string, peerAppUserId: string): Promise<void> {
  const me = canonAppUserId(meAppUserId);
  const peer = canonAppUserId(peerAppUserId);
  if (!me || !peer || me === peer) return;
  const { error } = await supabase.rpc('user_blocks_unblock', { p_me: me, p_peer: peer });
  if (error) throw new Error(error.message);
}

/**
 * 단방향(내 기준) 차단 확인.
 * - "상대가 나를 차단했는지"는 앱에서 알 수 없어야 하므로 제공하지 않습니다.
 */
export async function isPeerBlockedByMe(meAppUserId: string, peerAppUserId: string): Promise<boolean> {
  const me = canonAppUserId(meAppUserId);
  const peer = canonAppUserId(peerAppUserId);
  if (!me || !peer || me === peer) return false;
  const { data, error } = await supabase.rpc('user_blocks_is_blocked', { p_me: me, p_peer: peer });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

