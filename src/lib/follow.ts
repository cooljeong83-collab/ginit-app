import { supabase } from '@/src/lib/supabase';

export type FollowRelationStatus = 'none' | 'following' | 'requested_out' | 'requested_in' | 'follower' | 'mutual';

export type FollowRelationStatusRow = {
  status: FollowRelationStatus;
  out_id?: string | null;
  in_id?: string | null;
};

export type FollowListRow = {
  id: string;
  peer_app_user_id: string;
  status: string;
  updated_at?: string;
};

export type FollowPendingInboxRow = {
  id: string;
  requester_app_user_id: string;
  status: string;
  created_at?: string;
};

export type FollowPendingOutboxRow = {
  id: string;
  addressee_app_user_id: string;
  status: string;
  created_at?: string;
};

function parseJsonbArray<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data as T[];
}

function parseRelationStatus(data: unknown): FollowRelationStatusRow {
  const o = (data ?? {}) as Record<string, unknown>;
  const raw = typeof o.status === 'string' ? o.status.trim() : 'none';
  const status: FollowRelationStatus =
    raw === 'following' || raw === 'requested_out' || raw === 'requested_in' || raw === 'follower' || raw === 'mutual'
      ? raw
      : 'none';
  return {
    status,
    out_id: typeof o.out_id === 'string' ? o.out_id : null,
    in_id: typeof o.in_id === 'string' ? o.in_id : null,
  };
}

export async function sendFollowRequest(followerAppUserId: string, followeeAppUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('follow_send_request', {
    p_follower: followerAppUserId.trim(),
    p_followee: followeeAppUserId.trim(),
  });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

export async function unfollow(followerAppUserId: string, followeeAppUserId: string): Promise<void> {
  const { error } = await supabase.rpc('follow_unfollow', {
    p_follower: followerAppUserId.trim(),
    p_followee: followeeAppUserId.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function acceptFollowRequest(meAppUserId: string, followId: string): Promise<void> {
  const { error } = await supabase.rpc('follow_accept', {
    p_me: meAppUserId.trim(),
    p_follow_id: followId.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function rejectFollowRequest(meAppUserId: string, followId: string): Promise<void> {
  const { error } = await supabase.rpc('follow_reject', {
    p_me: meAppUserId.trim(),
    p_follow_id: followId.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function fetchFollowRelationStatus(meAppUserId: string, peerAppUserId: string): Promise<FollowRelationStatusRow> {
  const me = meAppUserId.trim();
  const peer = peerAppUserId.trim();
  if (!me || !peer || me === peer) return { status: 'none', out_id: null, in_id: null };
  const { data, error } = await supabase.rpc('follow_relation_status', { p_me: me, p_peer: peer });
  if (error) throw new Error(error.message);
  return parseRelationStatus(data);
}

export async function fetchFollowingList(meAppUserId: string): Promise<FollowListRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('follow_following_list', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FollowListRow>(data);
}

export async function fetchFollowersList(meAppUserId: string): Promise<FollowListRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('follow_followers_list', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FollowListRow>(data);
}

export async function fetchFollowPendingInbox(meAppUserId: string): Promise<FollowPendingInboxRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('follow_pending_inbox', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FollowPendingInboxRow>(data);
}

export async function fetchFollowPendingOutbox(meAppUserId: string): Promise<FollowPendingOutboxRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('follow_pending_outbox', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FollowPendingOutboxRow>(data);
}

/** 회원 탈퇴: 팔로워/팔로잉/맞팔(요청 포함) 관계를 모두 삭제합니다. */
export async function purgeAllFollowRelations(meAppUserId: string): Promise<void> {
  const me = meAppUserId.trim();
  if (!me) return;
  const { error } = await supabase.rpc('follow_purge_user', { p_me: me });
  if (error) throw new Error(error.message);
}

