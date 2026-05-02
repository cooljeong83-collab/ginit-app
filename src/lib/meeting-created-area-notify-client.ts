import { publicEnv } from '@/src/config/public-env';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

/**
 * 공개 모임 생성 직후 Edge `meeting-created-area-notify` 를 호출합니다.
 * (DB Webhook 미설정 시에도 FCM fan-out 이 동작하도록 앱 보조 경로)
 *
 * 진단: `EXPO_PUBLIC_GINIT_NOTIFY_DEBUG=1` 또는 __DEV__ 에서 Metro/logcat 에 `[GinitNotify:meeting-created-notify]` 필터.
 * 수신 단말은 [GinitNotify:fcm-notifee-display] / [GinitNotify:FcmMessaging] 로 quiet hours·skip_no_content 확인.
 */
export function invokeMeetingCreatedAreaNotifyFireAndForget(meetingId: string, hostAppUserId: string): void {
  const mid = meetingId.trim();
  const host = hostAppUserId.trim();
  if (!mid || !host) {
    ginitNotifyDbg('meeting-created-notify', 'invoke_skip', { reason: 'empty_meeting_or_host' });
    return;
  }
  const base = publicEnv.supabaseUrl?.trim().replace(/\/$/, '');
  const anon = publicEnv.supabaseAnonKey?.trim();
  if (!base || !anon) {
    ginitNotifyDbg('meeting-created-notify', 'invoke_skip', {
      reason: 'missing_supabase_url_or_anon',
      hasUrl: Boolean(base),
      hasAnon: Boolean(anon),
    });
    return;
  }
  const url = `${base}/functions/v1/meeting-created-area-notify`;
  ginitNotifyDbg('meeting-created-notify', 'invoke_start', { meetingId: mid });
  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify({ meetingId: mid, p_host_app_user_id: host }),
  })
    .then(async (res) => {
      let bodyPreview = '';
      try {
        const t = await res.text();
        bodyPreview = t.length > 280 ? `${t.slice(0, 280)}…` : t;
      } catch {
        bodyPreview = '(read body failed)';
      }
      let reason: string | undefined;
      if (res.ok) {
        try {
          const j = JSON.parse(bodyPreview) as { reason?: unknown };
          if (typeof j.reason === 'string') reason = j.reason;
        } catch {
          /* ignore */
        }
      }
      ginitNotifyDbg('meeting-created-notify', 'invoke_response', {
        status: res.status,
        ok: res.ok,
        reason: reason ?? undefined,
        bodyPreview: res.ok ? undefined : bodyPreview,
      });
      if (!res.ok && typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[meeting-created-notify]', res.status, bodyPreview);
      }
    })
    .catch((e) => {
      ginitNotifyDbg('meeting-created-notify', 'invoke_fetch_error', {
        message: e instanceof Error ? e.message : String(e),
      });
    });
}
