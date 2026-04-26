import { supabase } from '@/src/lib/supabase';

/**
 * `public.friends` INSERT/UPDATE/DELETE 시 콜백.
 * RLS로 본인 관련 행만 전달되므로, 필터 없이 테이블 단위 구독합니다.
 */
export function subscribeFriendsTableChanges(onChange: () => void, onError?: (message: string) => void): () => void {
  let cancelled = false;
  const channel = supabase
    .channel(`realtime:friends:${Date.now()}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friends' }, () => {
      if (!cancelled) onChange();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        onError?.('Supabase Realtime(friends) 연결 오류');
      }
    });
  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}
