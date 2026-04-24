import { supabase } from '@/src/lib/supabase';

export type FriendInboxRow = {
  id: string;
  requester_app_user_id: string;
  addressee_app_user_id: string;
  status: string;
  created_at?: string;
};

export type FriendAcceptedRow = {
  id: string;
  peer_app_user_id: string;
  status: string;
  updated_at?: string;
};

function parseJsonbArray<T>(data: unknown): T[] {
  if (!Array.isArray(data)) return [];
  return data as T[];
}

export async function fetchFriendsPendingInbox(meAppUserId: string): Promise<FriendInboxRow[]> {
  const me = meAppUserId.trim();
  if (!me) return [];
  const { data, error } = await supabase.rpc('friends_pending_inbox', { p_me: me });
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

export async function acceptGinitRequest(meAppUserId: string, friendshipId: string): Promise<void> {
  const { error } = await supabase.rpc('friends_accept', {
    p_me: meAppUserId.trim(),
    p_friendship_id: friendshipId.trim(),
  });
  if (error) throw new Error(error.message);
}
