/**
 * Send FCM push notifications to Android devices using stored `profiles.fcm_token`.
 *
 * 구현: Firebase Admin SDK(`npm:firebase-admin`)는 Deno Edge에서 `node:http2` 의
 * `callTimeout` 미구현으로 UncaughtException 이 날 수 있어, **FCM HTTP v1 REST + fetch** 만 사용합니다.
 *
 * Secrets:
 * - `FIREBASE_SERVICE_ACCOUNT_JSON`: full service account JSON string.
 * - auto-injected `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * Request (POST JSON):
 * - { "toUserIds": ["010...","..."], "title": "string", "body": "string", "data": { ... } }
 *
 * Notes:
 * - `profiles.fcm_platform = 'android'` 인 토큰은 **data-only**(title/body는 data에 포함).
 * - `ios` 또는 미기록(null) 토큰은 `notification` payload 포함.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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

type ServiceAccountCreds = {
  project_id?: unknown;
  client_email?: unknown;
  private_key?: unknown;
};

function parseServiceAccountJson(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

function logServiceAccountDiag(cred: ServiceAccountCreds): void {
  const projectId = typeof cred.project_id === 'string' ? cred.project_id : '';
  const clientEmail = typeof cred.client_email === 'string' ? cred.client_email : '';
  const pk = typeof cred.private_key === 'string' ? cred.private_key : '';
  const at = clientEmail.indexOf('@');
  const emailDomain = at > 0 ? clientEmail.slice(at + 1) : '';
  console.log(
    '[fcm-push-send] service_account_diag',
    JSON.stringify({
      project_id: projectId || '(missing in json)',
      client_email_domain: emailDomain || '(missing)',
      private_key_present: pk.length > 0,
      private_key_starts_with_begin: pk.trimStart().startsWith('-----BEGIN'),
    }),
  );
}

function pemPkcs8ToBinary(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, '\n');
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
  const b64 = lines.filter((l) => !l.startsWith('-----')).join('');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importServiceAccountSigningKey(privateKeyPem: string): Promise<CryptoKey> {
  const der = pemPkcs8ToBinary(privateKeyPem);
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function base64UrlEncodeJson(obj: unknown): string {
  const s = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createJwtForGoogleAccess(clientEmail: string, privateKey: CryptoKey): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const p1 = base64UrlEncodeJson(header);
  const p2 = base64UrlEncodeJson(payload);
  const toSign = new TextEncoder().encode(`${p1}.${p2}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, toSign);
  const p3 = base64UrlEncodeBytes(sig);
  return `${p1}.${p2}.${p3}`;
}

async function fetchGoogleAccessTokenForFcm(clientEmail: string, privateKey: CryptoKey): Promise<string> {
  const assertion = await createJwtForGoogleAccess(clientEmail, privateKey);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown; error_description?: unknown };
  const token = typeof j.access_token === 'string' ? j.access_token.trim() : '';
  if (!res.ok || !token) {
    const err = typeof j.error === 'string' ? j.error : 'oauth_token_failed';
    const desc = typeof j.error_description === 'string' ? j.error_description : JSON.stringify(j).slice(0, 400);
    throw new Error(`${err}: ${desc}`);
  }
  return token;
}

function extractFcmErrorCode(body: unknown): string | undefined {
  const details = (body as { error?: { details?: unknown } })?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    const t = String((d as { ['@type']?: unknown })?.['@type'] ?? '');
    if (t.includes('FcmError')) {
      const code = (d as { errorCode?: unknown })?.errorCode;
      if (typeof code === 'string' && code.trim()) return code.trim();
    }
  }
  return undefined;
}

function mapFcmErrorToPseudoMessagingCode(fcmCode: string | undefined): string {
  if (fcmCode === 'UNREGISTERED') return 'messaging/registration-token-not-registered';
  if (fcmCode === 'INVALID_ARGUMENT') return 'messaging/invalid-registration-token';
  return fcmCode ? `messaging/${fcmCode}` : 'messaging/unknown';
}

async function sendFcmHttpV1Message(
  projectId: string,
  accessToken: string,
  fcmToken: string,
  kind: 'android' | 'legacy',
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ success: boolean; error?: { code?: string; message?: string } }> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const dataForAndroid = { ...data, title, body };

  const message: Record<string, unknown> =
    kind === 'android'
      ? {
          token: fcmToken,
          data: dataForAndroid,
          android: { priority: 'high' },
        }
      : {
          token: fcmToken,
          notification: { title, body },
          data,
          android: {
            priority: 'high',
            notification: {
              /** 앱 `ensureGinitFcmNotifeeChannel` / `FcmMessagingBootstrap` 과 동일 ID (HIGH) */
              channel_id: 'ginit_fcm',
            },
          },
          apns: {
            payload: { aps: { sound: 'default' } },
          },
        };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const parsed: unknown = await res.json().catch(() => ({}));
  const name = typeof (parsed as { name?: unknown })?.name === 'string' ? String((parsed as { name: string }).name).trim() : '';
  if (res.ok && name.length > 0) {
    return { success: true };
  }

  const fcmCode = extractFcmErrorCode(parsed);
  const pseudo = mapFcmErrorToPseudoMessagingCode(fcmCode);
  const msgRaw = (parsed as { error?: { message?: unknown } })?.error?.message;
  const msg = typeof msgRaw === 'string' ? msgRaw : JSON.stringify(parsed).slice(0, 280);
  return { success: false, error: { code: pseudo, message: msg } };
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
    if (toUserIds.length > 50) return jsonResponse({ ok: false, error: 'toUserIds too large' }, 400);

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const data = dataToStringRecord(payload.data);
    const action = String(data.action ?? '').trim();
    const roomId = String(data.meetingId ?? '').trim();
    const fromUserId = String(data.fromUserId ?? '').trim();

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

    if (fromUserId && toUserIds.length > 0) {
      const ids = [...new Set([fromUserId, ...toUserIds])];
      const { data: blockRows, error: blockErr } = await supabase
        .from('user_blocks')
        .select('blocker_app_user_id, blocked_app_user_id')
        .in('blocker_app_user_id', ids)
        .in('blocked_app_user_id', ids);
      if (blockErr) return jsonResponse({ ok: false, error: blockErr.message }, 500);

      const blockedPairs = new Set<string>();
      for (const r of blockRows ?? []) {
        const a = String((r as any)?.blocker_app_user_id ?? '').trim();
        const b = String((r as any)?.blocked_app_user_id ?? '').trim();
        if (a && b) blockedPairs.add(`${a}__${b}`);
      }
      if (blockedPairs.size > 0) {
        toUserIds = toUserIds.filter((to) => {
          const t = String(to ?? '').trim();
          if (!t) return false;
          const ab = `${fromUserId}__${t}`;
          const ba = `${t}__${fromUserId}`;
          return !(blockedPairs.has(ab) || blockedPairs.has(ba));
        });
      }
      if (toUserIds.length === 0) {
        return jsonResponse({ ok: true, attempted: 0, sent: 0, reason: 'all_recipients_blocked' });
      }
    }

    const { data: rows, error } = await supabase
      .from('profiles')
      .select('id, fcm_token, fcm_platform')
      .in('app_user_id', toUserIds);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);

    const tokenPlatform = new Map<string, 'android' | 'legacy'>();
    for (const r of rows ?? []) {
      const t = typeof (r as any)?.fcm_token === 'string' ? String((r as any).fcm_token).trim() : '';
      if (!t || tokenPlatform.has(t)) continue;
      const platRaw = typeof (r as any)?.fcm_platform === 'string' ? String((r as any).fcm_platform).trim().toLowerCase() : '';
      tokenPlatform.set(t, platRaw === 'android' ? 'android' : 'legacy');
    }
    const androidTokens = [...tokenPlatform.entries()].filter(([, p]) => p === 'android').map(([tok]) => tok);
    const legacyTokens = [...tokenPlatform.entries()].filter(([, p]) => p === 'legacy').map(([tok]) => tok);
    const uniqueTokens = [...tokenPlatform.keys()];
    if (uniqueTokens.length === 0) {
      return jsonResponse({ ok: true, attempted: toUserIds.length, sent: 0, reason: 'no_tokens' });
    }

    const rawSa = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
    if (!rawSa) {
      console.error('[fcm-push-send] FIREBASE_SERVICE_ACCOUNT_JSON missing (set Supabase Edge secret)');
      return jsonResponse({ ok: false, error: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON' }, 500);
    }

    let cred: Record<string, unknown>;
    try {
      cred = parseServiceAccountJson(rawSa);
    } catch (e) {
      console.error('[fcm-push-send] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON', String(e));
      return jsonResponse({ ok: false, error: 'Invalid FIREBASE_SERVICE_ACCOUNT_JSON' }, 500);
    }

    logServiceAccountDiag(cred as ServiceAccountCreds);

    const projectId = typeof cred.project_id === 'string' ? cred.project_id.trim() : '';
    const clientEmail = typeof cred.client_email === 'string' ? cred.client_email.trim() : '';
    const privateKeyPem = typeof cred.private_key === 'string' ? cred.private_key : '';
    if (!projectId || !clientEmail || !privateKeyPem) {
      return jsonResponse({ ok: false, error: 'Service account JSON missing project_id, client_email, or private_key' }, 500);
    }

    let signingKey: CryptoKey;
    let accessToken: string;
    try {
      signingKey = await importServiceAccountSigningKey(privateKeyPem);
      accessToken = await fetchGoogleAccessTokenForFcm(clientEmail, signingKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[fcm-push-send] auth_failed', msg);
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    console.log('[fcm-push-send] fcm_http_v1_ready', JSON.stringify({ project_id: projectId }));

    const allResponses: { success: boolean; error?: { message?: string; code?: string } }[] = [];
    const allTokensOrdered: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    const runBatch = async (tokens: string[], kind: 'android' | 'legacy') => {
      const batch = await Promise.all(
        tokens.map((tok) => sendFcmHttpV1Message(projectId, accessToken, tok, kind, title, body, data)),
      );
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        const r = batch[i]!;
        allTokensOrdered.push(tok);
        allResponses.push(r);
        if (r.success) successCount += 1;
        else failureCount += 1;
      }
    };

    try {
      if (androidTokens.length > 0) await runBatch(androidTokens, 'android');
      if (legacyTokens.length > 0) await runBatch(legacyTokens, 'legacy');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[fcm-push-send] send_fcm_http_v1_failed', msg);
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    try {
      const invalidTokens: string[] = [];
      for (let i = 0; i < allResponses.length; i++) {
        const r = allResponses[i];
        if (r?.success) continue;
        const code = String((r?.error as { code?: unknown } | undefined)?.code ?? '').trim();
        const isInvalidTokenCode =
          code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered';
        if (!isInvalidTokenCode) continue;
        const tok = allTokensOrdered[i];
        if (tok) invalidTokens.push(tok);
      }
      if (invalidTokens.length > 0) {
        await supabase.from('profiles').update({ fcm_token: null }).in('fcm_token', invalidTokens);
      }
    } catch {
      /* ignore */
    }

    return jsonResponse({
      ok: true,
      attempted: uniqueTokens.length,
      successCount,
      failureCount,
      errorsSample: allResponses
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
