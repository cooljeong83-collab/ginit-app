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
 * - `ios` 또는 미기록(null) 토큰은 `notification` payload 포함(채널·`aps.sound`는 `profiles.metadata.notification_sound` 반영).
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

/** RN `getGinitFcmDisplayNotifeeChannelId` / `notifeeAndroidRawBaseName`(벨1 raw=`ginit_bell_1`) 과 동일 규칙 유지 */
type EdgeBundledSoundPref = 'default' | 'ginit_ring_w' | 'ginit_ring_c1';

function normalizeEdgeNotificationSoundId(raw: unknown): EdgeBundledSoundPref {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'default' || s === 'system') return 'default';
  if (s === 'ginit_ring_c1') return 'ginit_ring_c1';
  if (s === 'ginit_ring_w') return 'ginit_ring_w';
  return 'ginit_ring_w';
}

/** RN `notifeeAndroidRawBaseName`(지닛 벨1 → `ginit_bell_1`) 과 동일해야 레거시 notification 채널이 맞습니다 */
function fcmLegacyAndroidChannelId(pref: EdgeBundledSoundPref): string {
  if (pref === 'default') return 'ginit_fcm_w_default';
  if (pref === 'ginit_ring_c1') return 'ginit_fcm_w_ginit_ring_c1';
  return 'ginit_fcm_w_ginit_bell_1';
}

function fcmLegacyIosApsSound(pref: EdgeBundledSoundPref): string {
  if (pref === 'default') return 'default';
  if (pref === 'ginit_ring_c1') return 'ginit_ring_c1.wav';
  return 'ginit_bell_1.wav';
}

type LegacyFcmDisplayOpts = {
  androidChannelId: string;
  iosApsSound: string;
};

async function sendFcmHttpV1Message(
  projectId: string,
  accessToken: string,
  fcmToken: string,
  kind: 'android' | 'legacy',
  title: string,
  body: string,
  data: Record<string, string>,
  legacyDisplay?: LegacyFcmDisplayOpts,
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
              /** 앱 `ensureGinitFcmNotifeeChannel` 이 만든 채널과 동일 ID (프로필 `metadata.notification_sound`) */
              channel_id: legacyDisplay?.androidChannelId ?? 'ginit_fcm_w_default',
            },
          },
          apns: {
            payload: { aps: { sound: legacyDisplay?.iosApsSound ?? 'default' } },
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

function maskAppUserId(id: string): string {
  const t = id.trim();
  if (!t) return '(empty)';
  if (t.includes('@')) {
    const [a, d] = t.split('@');
    const al = (a ?? '').length;
    return `${al > 2 ? `${(a ?? '').slice(0, 2)}…` : '?'}@${d ?? ''}`;
  }
  if (t.length <= 10) return `${t.slice(0, 2)}…`;
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function fcmPushLog(runId: string, phase: string, detail: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ runId, phase, ts: new Date().toISOString(), ...detail });
  console.log(`[fcm-push-send] ${line}`);
}

serve(async (req) => {
  const runId = crypto.randomUUID().slice(0, 8);
  if (req.method === 'OPTIONS') {
    fcmPushLog(runId, 'options', {});
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    fcmPushLog(runId, 'reject_method', { method: req.method });
    return jsonResponse({ ok: false, error: 'POST only' }, 405);
  }

  try {
    fcmPushLog(runId, 'request_start', { urlPath: new URL(req.url).pathname });
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!supabaseUrl || !serviceRole) {
      fcmPushLog(runId, 'missing_supabase_env', { hasUrl: Boolean(supabaseUrl), hasServiceRole: Boolean(serviceRole) });
      return jsonResponse({ ok: false, error: 'Missing Supabase env' }, 500);
    }

    let payload: ReqBody;
    try {
      payload = (await req.json()) as ReqBody;
    } catch {
      fcmPushLog(runId, 'invalid_json_body', {});
      return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    let toUserIds = normalizeIds(payload.toUserIds);
    const title = String(payload.title ?? '').trim();
    const body = String(payload.body ?? '').trim();
    if (toUserIds.length === 0) {
      fcmPushLog(runId, 'validation_fail', { reason: 'toUserIds_empty' });
      return jsonResponse({ ok: false, error: 'toUserIds is empty' }, 400);
    }
    if (!title || !body) {
      fcmPushLog(runId, 'validation_fail', { reason: 'title_or_body_empty' });
      return jsonResponse({ ok: false, error: 'title/body required' }, 400);
    }
    if (toUserIds.length > 50) {
      fcmPushLog(runId, 'validation_fail', { reason: 'toUserIds_too_large', count: toUserIds.length });
      return jsonResponse({ ok: false, error: 'toUserIds too large' }, 400);
    }

    fcmPushLog(runId, 'payload_ok', {
      toUserCount: toUserIds.length,
      toUserMasks: toUserIds.slice(0, 5).map(maskAppUserId),
      titleLen: title.length,
      bodyLen: body.length,
      dataKeys: Object.keys(dataToStringRecord(payload.data)).slice(0, 12),
    });

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
      if (prefErr) {
        fcmPushLog(runId, 'chat_pref_query_error', { message: prefErr.message });
        return jsonResponse({ ok: false, error: prefErr.message }, 500);
      }
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
        fcmPushLog(runId, 'early_exit', { reason: 'all_recipients_muted', roomIdTail: roomId.length > 8 ? roomId.slice(-8) : roomId });
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
      if (blockErr) {
        fcmPushLog(runId, 'user_blocks_query_error', { message: blockErr.message });
        return jsonResponse({ ok: false, error: blockErr.message }, 500);
      }

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
        fcmPushLog(runId, 'early_exit', { reason: 'all_recipients_blocked' });
        return jsonResponse({ ok: true, attempted: 0, sent: 0, reason: 'all_recipients_blocked' });
      }
    }

    type ProfileTokenRow = { fcm_token?: unknown; fcm_platform?: unknown; notification_sound?: unknown };
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('fcm_push_list_profile_tokens_for_user_ids', {
      p_app_user_ids: toUserIds,
    });
    let rows: ProfileTokenRow[] | null = (rpcRows ?? null) as ProfileTokenRow[] | null;
    if (rpcErr) {
      fcmPushLog(runId, 'profile_tokens_rpc_error', { message: rpcErr.message, code: rpcErr.code ?? '' });
      const fb = await supabase.from('profiles').select('fcm_token, fcm_platform, metadata').in('app_user_id', toUserIds);
      if (fb.error) {
        fcmPushLog(runId, 'profile_tokens_fallback_error', { message: fb.error.message });
        return jsonResponse({ ok: false, error: fb.error.message }, 500);
      }
      const fbRows = (fb.data ?? []) as { fcm_token?: unknown; fcm_platform?: unknown; metadata?: unknown }[];
      rows = fbRows.map((row) => {
        const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
        const ns = meta.notification_sound;
        return {
          fcm_token: row.fcm_token,
          fcm_platform: row.fcm_platform,
          notification_sound: typeof ns === 'string' ? ns : undefined,
        };
      });
      fcmPushLog(runId, 'profile_tokens_fallback_ok', { rowCount: rows?.length ?? 0 });
    } else {
      fcmPushLog(runId, 'profile_tokens_rpc_ok', { rowCount: rows?.length ?? 0 });
    }

    type TokenJob = { token: string; platform: 'android' | 'legacy'; soundPref: EdgeBundledSoundPref };
    const tokenJobs: TokenJob[] = [];
    const seenTok = new Set<string>();
    for (const r of rows ?? []) {
      const t = typeof (r as any)?.fcm_token === 'string' ? String((r as any).fcm_token).trim() : '';
      if (!t || seenTok.has(t)) continue;
      seenTok.add(t);
      const platRaw = typeof (r as any)?.fcm_platform === 'string' ? String((r as any).fcm_platform).trim().toLowerCase() : '';
      const platform = platRaw === 'android' ? 'android' : 'legacy';
      const soundPref = normalizeEdgeNotificationSoundId((r as any)?.notification_sound);
      tokenJobs.push({ token: t, platform, soundPref });
    }
    const uniqueTokens = tokenJobs.map((j) => j.token);
    if (uniqueTokens.length === 0) {
      fcmPushLog(runId, 'early_exit', {
        reason: 'no_tokens',
        toUserCount: toUserIds.length,
        toUserMasks: toUserIds.slice(0, 5).map(maskAppUserId),
        action: String(data.action ?? '').trim() || undefined,
      });
      return jsonResponse({ ok: true, attempted: toUserIds.length, sent: 0, reason: 'no_tokens' });
    }

    fcmPushLog(runId, 'tokens_resolved', {
      uniqueTokenCount: uniqueTokens.length,
      androidCount: tokenJobs.filter((j) => j.platform === 'android').length,
      legacyCount: tokenJobs.filter((j) => j.platform === 'legacy').length,
    });

    const rawSa = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
    if (!rawSa) {
      fcmPushLog(runId, 'missing_firebase_sa', {});
      return jsonResponse({ ok: false, error: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON' }, 500);
    }

    let cred: Record<string, unknown>;
    try {
      cred = parseServiceAccountJson(rawSa);
    } catch (e) {
      fcmPushLog(runId, 'firebase_sa_json_invalid', { err: String(e) });
      return jsonResponse({ ok: false, error: 'Invalid FIREBASE_SERVICE_ACCOUNT_JSON' }, 500);
    }

    logServiceAccountDiag(cred as ServiceAccountCreds);

    const projectId = typeof cred.project_id === 'string' ? cred.project_id.trim() : '';
    const clientEmail = typeof cred.client_email === 'string' ? cred.client_email.trim() : '';
    const privateKeyPem = typeof cred.private_key === 'string' ? cred.private_key : '';
    if (!projectId || !clientEmail || !privateKeyPem) {
      fcmPushLog(runId, 'firebase_sa_incomplete', {
        hasProjectId: Boolean(projectId),
        hasClientEmail: Boolean(clientEmail),
        hasPrivateKey: Boolean(privateKeyPem),
      });
      return jsonResponse({ ok: false, error: 'Service account JSON missing project_id, client_email, or private_key' }, 500);
    }

    let signingKey: CryptoKey;
    let accessToken: string;
    try {
      signingKey = await importServiceAccountSigningKey(privateKeyPem);
      accessToken = await fetchGoogleAccessTokenForFcm(clientEmail, signingKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fcmPushLog(runId, 'google_oauth_failed', { message: msg });
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    fcmPushLog(runId, 'google_oauth_ok', { project_id: projectId });

    const allResponses: { success: boolean; error?: { message?: string; code?: string } }[] = [];
    const allTokensOrdered: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    const runAllTokenJobs = async () => {
      fcmPushLog(runId, 'fcm_batch_start', { kind: 'per_token', count: tokenJobs.length });
      const batch = await Promise.all(
        tokenJobs.map((job) =>
          sendFcmHttpV1Message(
            projectId,
            accessToken,
            job.token,
            job.platform,
            title,
            body,
            data,
            job.platform === 'legacy'
              ? {
                  androidChannelId: fcmLegacyAndroidChannelId(job.soundPref),
                  iosApsSound: fcmLegacyIosApsSound(job.soundPref),
                }
              : undefined,
          ),
        ),
      );
      for (let i = 0; i < tokenJobs.length; i++) {
        const tok = tokenJobs[i]!.token;
        const r = batch[i]!;
        allTokensOrdered.push(tok);
        allResponses.push(r);
        if (r.success) successCount += 1;
        else failureCount += 1;
      }
      const firstFail = batch.find((r) => !r.success);
      fcmPushLog(runId, 'fcm_batch_done', {
        kind: 'per_token',
        ok: batch.every((r) => r.success),
        firstErr: firstFail?.error?.message ?? null,
        firstCode: firstFail?.error?.code ?? null,
      });
    };

    try {
      if (tokenJobs.length > 0) await runAllTokenJobs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fcmPushLog(runId, 'fcm_batch_throw', { message: msg });
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

    const resBody = {
      ok: true,
      attempted: uniqueTokens.length,
      successCount,
      failureCount,
      errorsSample: allResponses
        .map((r, i) => ({ ok: r.success, idx: i, err: r.success ? null : r.error?.message ?? 'error' }))
        .filter((x) => !x.ok)
        .slice(0, 10),
    };
    fcmPushLog(runId, 'request_done', {
      ok: true,
      attempted: resBody.attempted,
      successCount: resBody.successCount,
      failureCount: resBody.failureCount,
    });
    return jsonResponse(resBody);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fcmPushLog(runId, 'unhandled_throw', { message: msg });
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
