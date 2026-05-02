/**
 * 공개 모임 INSERT 후 «관심 지역 × 카테고리» 구독자에게만 FCM 발송.
 *
 * 호출:
 * - Supabase Database Webhook (table `meetings`, INSERT) + HTTP Header `x-meeting-notify-secret`
 * - 수동: POST JSON `{ "meetingId": "<uuid>" }` 동일 헤더
 * - 앱: 공개 모임 `ledger_meeting_create` 직후 POST JSON `{ "meetingId": "<uuid>", "p_host_app_user_id": "<app_user_id>" }`
 *   (호스트 검증; DB Webhook 없을 때 보조 경로)
 *
 * Secrets (Edge):
 * - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (자동 주입)
 * - `MEETING_CREATED_NOTIFY_SECRET`: Webhook/수동 호출 시 `x-meeting-notify-secret` 와 동일 값(비우면 시크릿 경로 비활성)
 *
 * 내부에서 `fcm-push-send`를 service role로 호출합니다(건당 최대 50명 배치).
 *
 * 운영 점검:
 * - Supabase Dashboard → Edge Functions → meeting-created-area-notify → Logs (401/unauthorized, reason: no_subscribers 등)
 * - SQL 점검: `supabase/scripts/meeting-area-notify-diagnostics.sql`
 * - 구독자 RPC는 호스트 본인을 제외함. 수신 테스트는 다른 계정 기기에서 할 것.
 * - 로컬/배포: `supabase/config.toml` 의 `[functions.meeting-created-area-notify] verify_jwt = false` 를 배포에 반영할 것.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const FCM_ACTION = 'new_meeting_in_feed_region';
const FCM_BATCH = 50;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-meeting-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function normalizeSecretHeader(req: Request): string {
  const h = req.headers.get('x-meeting-notify-secret');
  return typeof h === 'string' ? h.trim() : '';
}

function extractMeetingId(body: Record<string, unknown>): string | null {
  const direct = body.meetingId ?? body.meeting_id;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const rec = body.record;
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
    const id = (rec as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function isAuthorizedCaller(
  req: Request,
  body: Record<string, unknown>,
  meetingId: string,
  supabaseUrl: string,
  serviceRole: string,
): Promise<boolean> {
  const expected = Deno.env.get('MEETING_CREATED_NOTIFY_SECRET')?.trim() ?? '';
  if (expected && normalizeSecretHeader(req) === expected) {
    return true;
  }

  const hostFromBody = typeof body.p_host_app_user_id === 'string' ? body.p_host_app_user_id.trim() : '';
  if (!hostFromBody) {
    return false;
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: mtg, error: mErr } = await supabase
    .from('meetings')
    .select('id, is_public, created_by_profile_id')
    .eq('id', meetingId)
    .maybeSingle();
  if (mErr || !mtg || mtg.is_public !== true) {
    return false;
  }

  const hostPid = (mtg as { created_by_profile_id?: unknown }).created_by_profile_id;
  if (hostPid == null) return false;

  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('app_user_id', hostFromBody)
    .maybeSingle();
  if (pErr || !prof?.id) {
    return false;
  }

  return String(prof.id) === String(hostPid);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceRole) {
    return jsonResponse({ ok: false, error: 'Missing Supabase env' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const meetingId = extractMeetingId(body);
  if (!meetingId) {
    return jsonResponse({ ok: false, error: 'meeting id missing' }, 400);
  }

  const allowed = await isAuthorizedCaller(req, body, meetingId, supabaseUrl, serviceRole);
  if (!allowed) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: priorSent, error: priorErr } = await supabase
    .from('meeting_created_area_notify_sent')
    .select('meeting_id')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (
    !priorErr &&
    priorSent &&
    typeof (priorSent as { meeting_id?: unknown }).meeting_id === 'string' &&
    (priorSent as { meeting_id: string }).meeting_id.trim() !== ''
  ) {
    return jsonResponse({ ok: true, sent: 0, reason: 'already_sent' });
  }

  const { data: rows, error: rpcErr } = await supabase.rpc('list_app_user_ids_for_meeting_area_notify', {
    p_meeting_id: meetingId,
  });
  if (rpcErr) {
    console.error('[meeting-created-area-notify] rpc', rpcErr.message);
    return jsonResponse({ ok: false, error: rpcErr.message }, 500);
  }

  const userIds = (Array.isArray(rows) ? rows : [])
    .map((r: unknown) => {
      if (r && typeof r === 'object' && 'app_user_id' in (r as object)) {
        return String((r as { app_user_id?: unknown }).app_user_id ?? '').trim();
      }
      return '';
    })
    .filter(Boolean);

  const unique = [...new Set(userIds)];
  if (unique.length === 0) {
    return jsonResponse({ ok: true, sent: 0, reason: 'no_subscribers' });
  }

  const { data: meetingRow, error: mErr } = await supabase
    .from('meetings')
    .select('title, category_label, feed_region_norm')
    .eq('id', meetingId)
    .maybeSingle();
  if (mErr) {
    console.error('[meeting-created-area-notify] meeting_select', mErr.message);
    return jsonResponse({ ok: false, error: mErr.message }, 500);
  }

  const titleRaw = meetingRow && typeof (meetingRow as { title?: unknown }).title === 'string'
    ? String((meetingRow as { title: string }).title).trim()
    : '';
  const title = titleRaw || '새 모임';
  const bodyText = '관심 지역에 새 공개 모임이 등록됐어요.';

  const fcmUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/fcm-push-send`;
  let totalSent = 0;
  const batches = chunk(unique, FCM_BATCH);
  for (const batch of batches) {
    const res = await fetch(fcmUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRole}`,
        apikey: serviceRole,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toUserIds: batch,
        title,
        body: bodyText,
        data: {
          action: FCM_ACTION,
          meetingId,
          meetingTitle: title,
          feedRegionNorm:
            meetingRow && typeof (meetingRow as { feed_region_norm?: unknown }).feed_region_norm === 'string'
              ? String((meetingRow as { feed_region_norm: string }).feed_region_norm).trim()
              : '',
        },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[meeting-created-area-notify] fcm-push-send', res.status, t.slice(0, 400));
      return jsonResponse({ ok: false, error: `fcm-push-send ${res.status}`, detail: t.slice(0, 200) }, 502);
    }
    try {
      const j = (await res.json()) as { successCount?: number; sent?: number };
      totalSent += typeof j.successCount === 'number' ? j.successCount : typeof j.sent === 'number' ? j.sent : 0;
    } catch {
      /* ignore */
    }
  }

  const { error: sentErr } = await supabase.from('meeting_created_area_notify_sent').insert({ meeting_id: meetingId });
  if (sentErr) {
    const code = typeof (sentErr as { code?: unknown }).code === 'string' ? (sentErr as { code: string }).code : '';
    if (code !== '23505' && !sentErr.message?.includes('does not exist') && !sentErr.message?.includes('relation')) {
      console.warn('[meeting-created-area-notify] dedupe log insert', sentErr.message);
    }
  }

  return jsonResponse({ ok: true, recipientCount: unique.length, fcmSuccessApprox: totalSent });
});
