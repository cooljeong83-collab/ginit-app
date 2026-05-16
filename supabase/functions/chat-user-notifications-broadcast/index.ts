/**
 * 채팅 목록·배지용 Realtime Broadcast + FCM `data.unread_count` (사용자별 `user_notifications:{profiles.id}`).
 *
 * Webhooks (Dashboard → Database → Webhooks):
 * 1) `public.chat_messages` INSERT → Realtime `unread_update` (+ 소셜 시 `refresh_list`) + **내부 호출** `fcm-push-send`
 *    — `data.unread_count`는 `chat_room_participants` 트리거 반영 후 `fetchUnreadCount`로 조회한 값.
 * 2) `public.chat_rooms` INSERT | UPDATE | DELETE (1:1만) → `refresh_list` 만 (FCM 없음)
 *
 * Headers: `Authorization: Bearer <SERVICE_ROLE_KEY>` 또는 `x-chat-notify-secret` + `CHAT_USER_NOTIFICATIONS_SECRET`.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.3';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-chat-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

type ChatMessageRow = {
  id?: string;
  room_kind?: string;
  room_id?: string;
  sender_app_user_id?: string;
  kind?: string;
  body_text?: string | null;
  deleted_at?: string | null;
};

type ChatRoomRow = {
  id?: string;
  is_group?: boolean;
  participant_ids?: string[] | null;
};

type DbWebhookBody = {
  type?: string;
  table?: string;
  schema?: string;
  record?: ChatMessageRow | ChatRoomRow;
  old_record?: ChatRoomRow;
};

function normalize(s: unknown): string {
  return typeof s === 'string' ? s.trim() : '';
}

function buildLastMessagePreview(row: ChatMessageRow): string {
  const kind = normalize(row.kind).toLowerCase() || 'text';
  const body = row.body_text != null ? String(row.body_text).trim() : '';
  if (kind === 'image') return '사진';
  if (kind === 'system') return body || '알림';
  return body || '(메시지)';
}

function compositeRoomId(roomKind: string, roomId: string): string {
  return `${roomKind}|${roomId}`;
}

type ChatBroadcastRecipient = { profileId: string; appUserId: string };

async function profileIdByAppUserIdMap(
  admin: ReturnType<typeof createClient>,
  appUserIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const CHUNK = 40;
  const uniq = [...new Set(appUserIds.map((x) => normalize(x)).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const { data, error } = await admin.from('profiles').select('id, app_user_id').in('app_user_id', chunk);
    if (error) {
      console.error('[chat-user-notifications-broadcast] profiles id map', error.message);
      continue;
    }
    for (const row of data ?? []) {
      const pid = normalize((row as { id?: string }).id);
      const au = normalize((row as { app_user_id?: string }).app_user_id);
      if (!pid || !au) continue;
      out.set(au, pid);
      out.set(au.toLowerCase(), pid);
    }
  }
  return out;
}

async function listChatMessageRecipients(
  admin: ReturnType<typeof createClient>,
  row: ChatMessageRow,
): Promise<ChatBroadcastRecipient[]> {
  const roomKind = normalize(row.room_kind).toLowerCase();
  const roomId = normalize(row.room_id);
  const sender = normalize(row.sender_app_user_id);
  if (!roomKind || !roomId) return [];

  const excludeSender = (appUid: string) =>
    Boolean(appUid && sender && appUid.toLowerCase() !== sender.toLowerCase());

  if (roomKind === 'meeting') {
    const { data: mp, error: e1 } = await admin.from('meeting_participants').select('profile_id').eq('meeting_id', roomId);
    if (e1) {
      console.error('[chat-user-notifications-broadcast] meeting_participants', e1.message);
      return [];
    }
    const pids = (mp ?? [])
      .map((r: { profile_id?: string }) => normalize(r.profile_id))
      .filter(Boolean);
    if (!pids.length) return [];
    const { data: pr, error: e2 } = await admin.from('profiles').select('id, app_user_id').in('id', pids);
    if (e2) {
      console.error('[chat-user-notifications-broadcast] profiles', e2.message);
      return [];
    }
    const out: ChatBroadcastRecipient[] = [];
    for (const p of pr ?? []) {
      const profileId = normalize((p as { id?: string }).id);
      const u = normalize((p as { app_user_id?: string }).app_user_id);
      if (profileId && u && excludeSender(u)) out.push({ profileId, appUserId: u });
    }
    return out;
  }

  if (roomKind === 'social_dm') {
    const { data: cr, error } = await admin.from('chat_rooms').select('participant_ids').eq('id', roomId).maybeSingle();
    if (error) {
      console.error('[chat-user-notifications-broadcast] chat_rooms', error.message);
      return [];
    }
    const ids = (cr as { participant_ids?: string[] } | null)?.participant_ids ?? [];
    const appCandidates: string[] = [];
    for (const raw of ids) {
      const u = normalize(raw);
      if (u && excludeSender(u)) appCandidates.push(u);
    }
    if (!appCandidates.length) return [];
    const idMap = await profileIdByAppUserIdMap(admin, appCandidates);
    const out: ChatBroadcastRecipient[] = [];
    for (const u of appCandidates) {
      const profileId = idMap.get(u) ?? idMap.get(u.toLowerCase());
      if (profileId) out.push({ profileId, appUserId: u });
    }
    return out;
  }

  return [];
}

async function fetchUnreadCount(
  admin: ReturnType<typeof createClient>,
  roomKind: string,
  roomId: string,
  appUserId: string,
): Promise<number> {
  const { data, error } = await admin
    .from('chat_room_participants')
    .select('unread_count')
    .eq('room_kind', roomKind)
    .eq('room_id', roomId)
    .eq('app_user_id', appUserId)
    .maybeSingle();
  if (error) {
    console.warn('[chat-user-notifications-broadcast] unread select', error.message);
    return 0;
  }
  const n = (data as { unread_count?: number } | null)?.unread_count;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

type BroadcastUnreadPayload = {
  room_id: string;
  last_message: string;
  unread_count: number;
  last_message_id: string;
  message_kind: string;
};

type RealtimeBroadcastWire = {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  private: boolean;
};

async function postRealtimeBroadcasts(
  supabaseUrl: string,
  serviceKey: string,
  messages: RealtimeBroadcastWire[],
): Promise<void> {
  if (messages.length === 0) return;
  const url = `${supabaseUrl.replace(/\/$/, '')}/realtime/v1/api/broadcast`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  if (res.status !== 202) {
    const t = await res.text();
    throw new Error(`Realtime broadcast HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
}

function userNotificationsBroadcastTopic(profileRowId: string): string {
  return `user_notifications:${profileRowId.trim().toLowerCase()}`;
}

async function broadcastUnreadUpdateAndRefreshList(
  supabaseUrl: string,
  serviceKey: string,
  profileRowId: string,
  payload: BroadcastUnreadPayload,
): Promise<void> {
  const topic = userNotificationsBroadcastTopic(profileRowId);
  await postRealtimeBroadcasts(supabaseUrl, serviceKey, [
    { topic, event: 'unread_update', payload: { ...payload }, private: true },
    { topic, event: 'refresh_list', payload: {}, private: true },
  ]);
}

async function broadcastRefreshListOnly(
  supabaseUrl: string,
  serviceKey: string,
  profileRowId: string,
): Promise<void> {
  const topic = userNotificationsBroadcastTopic(profileRowId);
  await postRealtimeBroadcasts(supabaseUrl, serviceKey, [
    { topic, event: 'refresh_list', payload: {}, private: true },
  ]);
}

async function broadcastUnreadUpdateOnly(
  supabaseUrl: string,
  serviceKey: string,
  profileRowId: string,
  payload: BroadcastUnreadPayload,
): Promise<void> {
  const topic = userNotificationsBroadcastTopic(profileRowId);
  await postRealtimeBroadcasts(supabaseUrl, serviceKey, [
    { topic, event: 'unread_update', payload: { ...payload }, private: true },
  ]);
}

async function fetchMeetingTitleForPush(admin: ReturnType<typeof createClient>, meetingId: string): Promise<string> {
  const mid = normalize(meetingId);
  if (!mid) return '모임';
  const { data, error } = await admin.from('meetings').select('title').eq('id', mid).maybeSingle();
  if (error) {
    console.warn('[chat-user-notifications-broadcast] meetings title', error.message);
    return '모임';
  }
  const t = normalize((data as { title?: string } | null)?.title);
  return t || '모임';
}

async function fetchSenderDisplayForPush(admin: ReturnType<typeof createClient>, senderAppUserId: string): Promise<string> {
  const u = normalize(senderAppUserId);
  if (!u) return '친구';
  const { data, error } = await admin
    .from('profiles')
    .select('nickname, display_name')
    .eq('app_user_id', u)
    .maybeSingle();
  if (error) {
    console.warn('[chat-user-notifications-broadcast] profiles sender', error.message);
    return '친구';
  }
  const row = data as { nickname?: string; display_name?: string } | null;
  const nick = normalize(row?.nickname);
  const disp = normalize(row?.display_name);
  return nick || disp || '친구';
}

/**
 * `fcm-push-send` — 채팅 액션(`in_app_chat` / `in_app_social_dm`) 및 `data.unread_count`(DB 트리거 기준).
 * 실패해도 Realtime 브로드캐스트는 이미 성공한 것으로 두고 로그만 남깁니다.
 */
async function sendChatMessageFcmPush(args: {
  supabaseUrl: string;
  serviceKey: string;
  recipientAppUserId: string;
  roomKind: 'meeting' | 'social_dm';
  roomId: string;
  senderAppUserId: string;
  senderDisplay: string;
  lastMessage: string;
  lastMessageId: string;
  unreadCount: number;
  meetingTitleForPush: string;
}): Promise<void> {
  const url = `${args.supabaseUrl.replace(/\/$/, '')}/functions/v1/fcm-push-send`;
  const action = args.roomKind === 'social_dm' ? 'in_app_social_dm' : 'in_app_chat';
  const title = args.roomKind === 'meeting' ? `「${args.meetingTitleForPush}」` : args.senderDisplay;
  const body = args.lastMessage || '새 메시지';
  const rid = normalize(args.roomId);
  const uid = normalize(args.recipientAppUserId);
  const from = normalize(args.senderAppUserId);
  const mid = normalize(args.lastMessageId);
  if (!rid || !uid) return;

  const data: Record<string, string> = {
    action,
    meetingId: rid,
    roomId: rid,
    roomType: args.roomKind,
    title,
    body,
    url: args.roomKind === 'social_dm' ? `ginitapp://social-chat/${encodeURIComponent(rid)}` : `ginitapp://meeting-chat/${rid}`,
    recipientUserId: uid,
    senderName: args.senderDisplay,
    ...(from ? { fromUserId: from } : {}),
    ...(mid ? { lastMessageId: mid, messageId: mid } : {}),
    /** 클라이언트 `parseChatPushDisplayData` → `serverUnreadCount` 최우선 소스 */
    unread_count: String(Math.max(0, Math.trunc(args.unreadCount))),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: args.serviceKey,
      Authorization: `Bearer ${args.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      toUserIds: [uid],
      title,
      body,
      data,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fcm-push-send HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
}

function authorize(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const auth = req.headers.get('authorization') ?? '';
  const secretHdr = req.headers.get('x-chat-notify-secret') ?? '';
  const expectedSecret = Deno.env.get('CHAT_USER_NOTIFICATIONS_SECRET') ?? '';

  if (serviceKey && auth === `Bearer ${serviceKey}`) return true;
  if (expectedSecret && secretHdr === expectedSecret) return true;
  return false;
}

function collectParticipantIds(primary: ChatRoomRow, old: ChatRoomRow | undefined, op: string): Set<string> {
  const ids = new Set<string>();
  const add = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      const u = normalize(raw);
      if (u) ids.add(u);
    }
  };
  add(primary.participant_ids);
  if (op === 'UPDATE' && old?.participant_ids) add(old.participant_ids);
  return ids;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  if (!authorize(req)) return jsonResponse({ error: 'unauthorized' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'missing_supabase_env' }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: DbWebhookBody;
  try {
    body = (await req.json()) as DbWebhookBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const table = normalize(body.table);
  const schema = normalize(body.schema);
  if (schema && schema !== 'public') {
    return jsonResponse({ ok: true, skipped: true, reason: 'wrong_schema' });
  }

  // ─── chat_rooms (1:1) — 목록용 refresh_list만 (postgres_changes 대체) ─────────
  if (table === 'chat_rooms') {
    const op = (normalize(body.type) || '').toUpperCase();
    if (!['INSERT', 'UPDATE', 'DELETE'].includes(op)) {
      return jsonResponse({ ok: true, skipped: true, reason: 'unsupported_operation' });
    }
    const rec = body.record as ChatRoomRow | undefined;
    const old = body.old_record as ChatRoomRow | undefined;
    const primary = op === 'DELETE' ? old : rec;
    if (!primary || typeof primary !== 'object') {
      return jsonResponse({ error: 'missing_chat_room_record' }, 400);
    }
    if (primary.is_group !== false) {
      return jsonResponse({ ok: true, skipped: true, reason: 'not_dm_room' });
    }
    const ids = collectParticipantIds(primary, old, op);
    if (!ids.size) {
      return jsonResponse({ ok: true, broadcast: 0, recipients: 0, event: 'refresh_list' });
    }
    const idMap = await profileIdByAppUserIdMap(admin, [...ids]);
    let ok = 0;
    const errors: string[] = [];
    for (const appUid of ids) {
      const profileId = idMap.get(appUid) ?? idMap.get(appUid.toLowerCase());
      if (!profileId) {
        console.warn('[chat-user-notifications-broadcast] refresh_list skip no profile id app=', appUid);
        continue;
      }
      try {
        await broadcastRefreshListOnly(supabaseUrl, serviceKey, profileId);
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[chat-user-notifications-broadcast] refresh_list profile=', profileId, msg);
        errors.push(`${profileId}:${msg.slice(0, 120)}`);
      }
    }
    return jsonResponse({
      ok: errors.length === 0,
      broadcast: ok,
      recipients: ids.size,
      event: 'refresh_list',
      errors: errors.length ? errors : undefined,
    });
  }

  if (table && table !== 'chat_messages' && table !== 'messages') {
    return jsonResponse({ ok: true, skipped: true, reason: 'wrong_table' });
  }

  if (body.type && body.type !== 'INSERT') {
    return jsonResponse({ ok: true, skipped: true, reason: 'not_insert' });
  }

  const record = body.record as ChatMessageRow | undefined;
  if (!record || typeof record !== 'object') {
    return jsonResponse({ error: 'missing_record' }, 400);
  }

  if (record.deleted_at) {
    return jsonResponse({ ok: true, skipped: true, reason: 'deleted_row' });
  }

  const roomKind = normalize(record.room_kind).toLowerCase();
  const roomId = normalize(record.room_id);
  if (!roomKind || !roomId || (roomKind !== 'meeting' && roomKind !== 'social_dm')) {
    return jsonResponse({ error: 'invalid_room' }, 400);
  }

  const recipients = await listChatMessageRecipients(admin, record);
  if (!recipients.length) {
    return jsonResponse({ ok: true, broadcast: 0, recipients: 0 });
  }

  const lastMessage = buildLastMessagePreview(record);
  const room_id = compositeRoomId(roomKind, roomId);
  const last_message_id = normalize(record.id);
  const message_kind = normalize(record.kind).toLowerCase() || 'text';
  const senderApp = normalize(record.sender_app_user_id);

  let meetingTitleForPush = '모임';
  if (roomKind === 'meeting') {
    meetingTitleForPush = await fetchMeetingTitleForPush(admin, roomId);
  }
  const senderDisplay = await fetchSenderDisplayForPush(admin, senderApp);

  let ok = 0;
  let fcmOk = 0;
  const errors: string[] = [];
  const fcmErrors: string[] = [];

  for (const r of recipients) {
    try {
      const unread_count = await fetchUnreadCount(admin, roomKind, roomId, r.appUserId);
      const payload: BroadcastUnreadPayload = {
        room_id,
        last_message: lastMessage,
        unread_count,
        last_message_id,
        message_kind,
      };
      if (roomKind === 'social_dm') {
        await broadcastUnreadUpdateAndRefreshList(supabaseUrl, serviceKey, r.profileId, payload);
      } else {
        await broadcastUnreadUpdateOnly(supabaseUrl, serviceKey, r.profileId, payload);
      }
      ok++;
      try {
        await sendChatMessageFcmPush({
          supabaseUrl,
          serviceKey,
          recipientAppUserId: r.appUserId,
          roomKind: roomKind as 'meeting' | 'social_dm',
          roomId,
          senderAppUserId: senderApp,
          senderDisplay,
          lastMessage,
          lastMessageId: last_message_id,
          unreadCount: unread_count,
          meetingTitleForPush,
        });
        fcmOk++;
      } catch (fe) {
        const fmsg = fe instanceof Error ? fe.message : String(fe);
        console.error('[chat-user-notifications-broadcast] fcm user=', r.appUserId, fmsg);
        fcmErrors.push(`${r.appUserId}:${fmsg.slice(0, 120)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[chat-user-notifications-broadcast] user=', r.appUserId, msg);
      errors.push(`${r.appUserId}:${msg.slice(0, 120)}`);
    }
  }

  return jsonResponse({
    ok: errors.length === 0,
    broadcast: ok,
    fcm_sent: fcmOk,
    recipients: recipients.length,
    errors: errors.length ? errors : undefined,
    fcm_errors: fcmErrors.length ? fcmErrors : undefined,
  });
});
