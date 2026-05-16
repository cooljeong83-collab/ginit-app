/**
 * 앱 사용자별 알림 행 — `public.notifications` (Supabase Realtime).
 * `user_id`는 앱 PK(`app_user_id`) 문자열입니다.
 */
import { formatRealtimeSubscribeDetail } from '@/src/lib/supabase-realtime-resilience';
import { supabase } from '@/src/lib/supabase';

export const NOTIFICATIONS_TABLE = 'notifications';

export type NotificationDoc = {
  id: string;
  userId: string;
  type: string;
  payload?: Record<string, unknown> | null;
  createdAt?: unknown;
  readAt?: unknown;
};

function mapNotificationRow(id: string, data: Record<string, unknown>): NotificationDoc {
  return {
    id,
    userId: typeof data.user_id === 'string' ? data.user_id.trim() : '',
    type: typeof data.type === 'string' ? data.type.trim() : 'unknown',
    payload:
      data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
        ? (data.payload as Record<string, unknown>)
        : null,
    createdAt: data.created_at ?? null,
    readAt: data.read_at ?? null,
  };
}

async function pullNotifications(uid: string, maxRows: number): Promise<NotificationDoc[]> {
  const { data, error } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .select('id,user_id,type,payload,created_at,read_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(200, Math.trunc(maxRows))));
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map((r) => {
    const rid = typeof r.id === 'string' ? r.id : String(r.id ?? '');
    return mapNotificationRow(rid, r);
  });
}

function randomRealtimeChannelSuffix(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 특정 사용자(`userId` = `app_user_id`) 알림을 최초 로드한 뒤,
 * `INSERT` / `UPDATE`에 대해 `postgres_changes`로 목록을 다시 가져옵니다.
 * (Realtime 채널 토픽에는 PII를 넣지 않습니다.)
 */
export function subscribeNotificationsForUser(
  appUserId: string,
  onData: (items: NotificationDoc[]) => void,
  onError?: (message: string) => void,
  maxRows = 80,
): () => void {
  const uid = appUserId.trim();
  if (!uid) {
    onData([]);
    return () => {};
  }

  let cancelled = false;
  const topic = `realtime:notifications:${randomRealtimeChannelSuffix()}`;
  const channel = supabase.channel(topic);
  if (__DEV__) console.log(`[notifications] realtime: channel created topic=${topic}`);

  const emit = () => {
    if (cancelled) return;
    void pullNotifications(uid, maxRows).then(
      (list) => {
        if (!cancelled) onData(list);
      },
      (e) => {
        if (cancelled) return;
        onError?.(e instanceof Error ? e.message : String(e));
      },
    );
  };

  emit();

  const filter = `user_id=eq.${uid.replace(/"/g, '\\"')}`;
  for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    channel.on(
      'postgres_changes',
      { event, schema: 'public', table: NOTIFICATIONS_TABLE, filter },
      () => {
        emit();
      },
    );
  }

  void channel.subscribe((status, err) => {
    if (__DEV__) console.log(`[notifications] realtime: ${formatRealtimeSubscribeDetail(status, err)} topic=${topic}`);
    if (status === 'CHANNEL_ERROR') {
      onError?.('Supabase Realtime(notifications) 연결 오류');
    }
  });

  return () => {
    cancelled = true;
    if (__DEV__) console.log(`[notifications] realtime: teardown → removeChannel topic=${topic}`);
    void supabase.removeChannel(channel);
  };
}
