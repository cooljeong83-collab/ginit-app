/**
 * Send FCM push notifications to Android devices using stored `profiles.fcm_token`.
 *
 * Why this exists:
 * - 현재 앱 코드의 "알람"은 클라이언트가 실행 중일 때만 원격 푸시를 전송(또는 로컬 알림 표시)하는 경로가 섞여 있을 수 있습니다.
 * - 앱이 완전히 종료(Quit)된 상태에서도 알림을 받으려면 서버(Edge Function 등)에서 FCM으로 직접 발송해야 합니다.
 *
 * Secrets:
 * - `FIREBASE_SERVICE_ACCOUNT_JSON`: full service account JSON string (same as other functions).
 * Uses:
 * - auto-injected `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * Request (POST JSON):
 * - { "toUserIds": ["010...","..."], "title": "string", "body": "string", "data": { ... } }
 *
 * Notes:
 * - OS가 앱이 꺼져 있어도 표시할 수 있도록 `notification` payload를 포함합니다.
 * - Android 13+에서는 수신자 디바이스에서 POST_NOTIFICATIONS 권한이 필요합니다.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { cert, getApps, initializeApp } from 'npm:firebase-admin@12/app';
import { getMessaging } from 'npm:firebase-admin@12/messaging';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getFirebaseMessaging() {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  const cred = JSON.parse(raw) as Record<string, unknown>;
  if (!getApps().length) {
    initializeApp({ credential: cert(cred as never) });
  }
  return getMessaging();
}

type ReqBody = {
  toUserIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

function normalizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === 'string' ? x.trim() : String(x ?? '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function dataToStringRecord(data: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!supabaseUrl || !serviceRole) {
      return jsonResponse({ ok: false, error: 'Missing Supabase env' }, 500);
    }

    /**
     * NOTE:
     * 현재 앱은 Supabase Auth 기반 세션을 쓰지 않으므로, 테스트 버튼에서 `Authorization: Bearer <supabase jwt>`를 제공할 수 없습니다.
     * 따라서 이 엔드포인트는 인증 없이 호출 가능하게 둡니다(테스트/내부용).
     *
     * 프로덕션에서 공개 호출을 막고 싶다면:
     * - `X-FCM-PUSH-KEY` 같은 헤더 시크릿을 요구하거나
     * - Supabase Auth 로그인(세션)으로 JWT를 제공하도록 앱 구조를 전환하세요.
     */

    let payload: ReqBody;
    try {
      payload = (await req.json()) as ReqBody;
    } catch {
      return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    let toUserIds = normalizeIds(payload.toUserIds);
    const title = String(payload.title ?? '').trim();
    const body = String(payload.body ?? '').trim();
    if (toUserIds.length === 0) return jsonResponse({ ok: false, error: 'toUserIds is empty' }, 400);
    if (!title || !body) return jsonResponse({ ok: false, error: 'title/body required' }, 400);
    // Abuse guard: prevent huge fan-out from clients
    if (toUserIds.length > 50) return jsonResponse({ ok: false, error: 'toUserIds too large' }, 400);

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const data = dataToStringRecord(payload.data);
    const action = String(data.action ?? '').trim();
    const roomId = String(data.meetingId ?? '').trim();

    if ((action === 'in_app_chat' || action === 'in_app_social_dm') && roomId) {
      const { data: prefRows, error: prefErr } = await supabase
        .from('chat_room_notify_preferences')
        .select('app_user_id, notify_enabled')
        .eq('room_id', roomId)
        .in('app_user_id', toUserIds);
      if (prefErr) return jsonResponse({ ok: false, error: prefErr.message }, 500);
      const muted = new Set(
        (prefRows ?? [])
          .filter((r: any) => r?.notify_enabled === false)
          .map((r: any) => String(r?.app_user_id ?? '').trim())
          .filter(Boolean),
      );
      if (muted.size > 0) {
        toUserIds = toUserIds.filter((id) => !muted.has(id));
      }
      if (toUserIds.length === 0) {
        return jsonResponse({ ok: true, attempted: 0, sent: 0, reason: 'all_recipients_muted' });
      }
    }

    const { data: rows, error } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .in('app_user_id', toUserIds);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);

    const tokens = (rows ?? [])
      .map((r: any) => (typeof r?.fcm_token === 'string' ? r.fcm_token.trim() : ''))
      .filter((t: string) => t.length > 0);
    // Dedupe: 한 사람이 여러 profile row를 갖거나(비정상), 같은 토큰이 재저장된 경우 fan-out 중복을 막습니다.
    const uniqueTokens = [...new Set(tokens)];
    if (uniqueTokens.length === 0) {
      return jsonResponse({ ok: true, attempted: toUserIds.length, sent: 0, reason: 'no_tokens' });
    }

    let messaging;
    try {
      messaging = getFirebaseMessaging();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    let res;
    try {
      res = await messaging.sendEachForMulticast({
        tokens: uniqueTokens,
        notification: { title, body },
        data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
          },
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    // Invalid token cleanup: Firebase Admin "에러 코드"가 명백할 때만 DB의 fcm_token을 비웁니다.
    // 문자열 contains 기반(/invalid/i) 오탐으로 유효 토큰이 지워지는 것을 방지합니다.
    try {
      const invalidTokens: string[] = [];
      for (let i = 0; i < res.responses.length; i++) {
        const r = res.responses[i];
        if (r?.success) continue;
        const code = String((r?.error as { code?: unknown } | undefined)?.code ?? '').trim();
        const isInvalidTokenCode =
          code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered';
        if (!isInvalidTokenCode) continue;
        const tok = uniqueTokens[i];
        if (tok) invalidTokens.push(tok);
      }
      if (invalidTokens.length > 0) {
        await supabase.from('profiles').update({ fcm_token: null }).in('fcm_token', invalidTokens);
      }
    } catch {
      // cleanup 실패는 무시(알림 전송 자체는 성공/실패 결과로 충분)
    }

    return jsonResponse({
      ok: true,
      attempted: uniqueTokens.length,
      successCount: res.successCount,
      failureCount: res.failureCount,
      // 너무 길어지는 것을 방지하기 위해 샘플만 반환
      errorsSample: res.responses
        .map((r, i) => ({ ok: r.success, idx: i, err: r.success ? null : r.error?.message ?? 'error' }))
        .filter((x) => !x.ok)
        .slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[fcm-push-send] unhandled error:', msg);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});

