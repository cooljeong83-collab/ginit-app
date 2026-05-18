/**
 * 앱 사용자별 알림 행 — `public.notifications` (Supabase Realtime).
 * `user_id`는 앱 PK(`app_user_id`) 문자열입니다.
 */
import { normalizeParticipantId } from '@/src/lib/app-user-id';
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

function mapNotificationRowsFromUnknown(data: unknown): NotificationDoc[] {
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const rid = typeof row.id === 'string' ? row.id : String(row.id ?? '');
    return mapNotificationRow(rid, row);
  });
}

export async function fetchNotificationsForUser(appUserId: string, maxRows = 80): Promise<NotificationDoc[]> {
  const uid = normalizeParticipantId(appUserId.trim()) || appUserId.trim();
  if (!uid) return [];
  return pullNotifications(uid, maxRows);
}

async function pullNotifications(uid: string, maxRows: number): Promise<NotificationDoc[]> {
  const limit = Math.max(1, Math.min(200, Math.trunc(maxRows)));
  const { data: rpcData, error: rpcError } = await supabase.rpc('list_app_notifications', {
    p_me: uid,
    p_limit: limit,
  });
  if (!rpcError) {
    return mapNotificationRowsFromUnknown(rpcData);
  }
  const { data, error } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .select('id,user_id,type,payload,created_at,read_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return mapNotificationRowsFromUnknown(data);
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
  const uid = normalizeParticipantId(appUserId.trim()) || appUserId.trim();
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
