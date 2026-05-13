import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { supabase } from '@/src/lib/supabase';

function friendsRealtimeEqFilter(column: 'requester_app_user_id' | 'addressee_app_user_id', rawAppUserId: string): string {
  const v = normalizeParticipantId(rawAppUserId).replace(/"/g, '\\"');
  return `${column}=eq."${v}"`;
}

/**
 * `public.friends` INSERT/UPDATE/DELETE 시 콜백.
 * - RLS(`friends_select_party`)로 서버에서도 행을 제한합니다.
 * - 클라이언트는 `requester` / `addressee` 각각에 대해 eq 필터를 걸어 불필요한 브로드캐스트를 줄입니다.
 */
export function subscribeFriendsTableChanges(
  viewerAppUserId: string,
  onChange: () => void,
  onError?: (message: string) => void,
): () => void {
  const me = normalizeParticipantId(viewerAppUserId);
  if (!me) return () => {};

  let cancelled = false;
  const channel = supabase.channel(`realtime:friends:${me}:${Date.now()}:${Math.random().toString(36).slice(2)}`);

  const fire = () => {
    if (!cancelled) onChange();
  };

  const events = ['INSERT', 'UPDATE', 'DELETE'] as const;
  const filters = [
    friendsRealtimeEqFilter('requester_app_user_id', me),
    friendsRealtimeEqFilter('addressee_app_user_id', me),
  ] as const;

  for (const event of events) {
    for (const filter of filters) {
      channel.on('postgres_changes', { event, schema: 'public', table: 'friends', filter }, fire);
    }
  }

  void channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (!cancelled) onChange();
    }
    if (status === 'CHANNEL_ERROR') {
      onError?.('Supabase Realtime(friends) 연결 오류');
    }
  });

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}
