import { supabase } from '@/src/lib/supabase';

export type FriendInboxRow = {
  id: string;
  requester_app_user_id: string;
  addressee_app_user_id: string;
  status: string;
  created_at?: string;
  updated_at?: string;
};

export type FriendAcceptedRow = {
  id: string;
  peer_app_user_id: string;
  status: string;
  updated_at?: string;
};

export type FriendRelationStatus = 'none' | 'pending_out' | 'pending_in' | 'accepted';

export type FriendRelationStatusRow = {
  status: FriendRelationStatus;
  friendship_id?: string | null;
  requester_app_user_id?: string | null;
  addressee_app_user_id?: string | null;
};

function parseJsonbArray<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data as T[];
}

function parseFriendshipId(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function parseRelationStatus(data: unknown): FriendRelationStatusRow {
  const o = (data ?? {}) as Record<string, unknown>;
  const statusRaw = typeof o.status === 'string' ? o.status : 'none';
  const status: FriendRelationStatus =
    statusRaw === 'accepted' || statusRaw === 'pending_out' || statusRaw === 'pending_in' ? statusRaw : 'none';
  return {
    status,
    friendship_id: parseFriendshipId(o.friendship_id),
    requester_app_user_id: typeof o.requester_app_user_id === 'string' ? o.requester_app_user_id : null,
    addressee_app_user_id: typeof o.addressee_app_user_id === 'string' ? o.addressee_app_user_id : null,
  };
}

export async function fetchFriendsPendingInbox(meAppUserId: string): Promise<FriendInboxRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('friends_pending_inbox', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FriendInboxRow>(data);
}

/** 내가 요청자인 지닛 내역(pending + 내가 보내 수락된 경우, 상대는 addressee). */
export async function fetchFriendsPendingOutbox(meAppUserId: string): Promise<FriendInboxRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('friends_pending_outbox', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FriendInboxRow>(data);
}

export async function fetchFriendsAcceptedList(meAppUserId: string): Promise<FriendAcceptedRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('friends_accepted_list', { p_me: me });
  if (error) throw new Error(error.message);
  return parseJsonbArray<FriendAcceptedRow>(data);
}

export async function sendGinitRequest(requesterAppUserId: string, addresseeAppUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('friends_send_ginit', {
    p_requester: requesterAppUserId.trim(),
    p_addressee: addresseeAppUserId.trim(),
  });
  if (error) throw new Error(error.message);
  return String(data ?? '');
}

export async function fetchFriendRelationStatus(meAppUserId: string, peerAppUserId: string): Promise<FriendRelationStatusRow> {
  const me = meAppUserId.trim();
  const peer = peerAppUserId.trim();
  if (!me || !peer || me === peer) return { status: 'none', friendship_id: null };
  const { data, error } = await supabase.rpc('friends_relation_status', {
    p_me: me,
    p_peer: peer,
  });
  if (error) throw new Error(error.message);
  return parseRelationStatus(data);
}

export async function acceptGinitRequest(meAppUserId: string, friendshipId: string): Promise<void> {
  const { error } = await supabase.rpc('friends_accept', {
    p_me: meAppUserId.trim(),
    p_friendship_id: friendshipId.trim(),
  });
  if (error) throw new Error(error.message);
}

/** 수신자가 대기 중인 지닛 요청을 거절합니다(`friends` 행 삭제). */
export async function declineGinitRequest(meAppUserId: string, friendshipId: string): Promise<void> {
  const { error } = await supabase.rpc('friends_decline', {
    p_me: meAppUserId.trim(),
    p_friendship_id: friendshipId.trim(),
  });
  if (error) throw new Error(error.message);
}

/** 요청자가 보낸 대기(pending) 지닛 요청을 취소합니다(`friends` 행 삭제). */
export async function cancelOutgoingGinitRequest(meAppUserId: string, friendshipId: string): Promise<void> {
  const { error } = await supabase.rpc('friends_cancel_outgoing', {
    p_me: meAppUserId.trim(),
    p_friendship_id: friendshipId.trim(),
  });
  if (error) throw new Error(error.message);
}
