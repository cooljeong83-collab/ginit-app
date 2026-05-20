/**
 * Send FCM to admin profiles only (profiles.admin = 'y').
 * Does NOT modify fcm-push-send behavior for regular users.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Body = {
  title: string;
  body: string;
  path?: string;
  priority?: 'urgent' | 'normal';
  reportId?: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const title = String(payload.title ?? '').trim();
  const body = String(payload.body ?? '').trim();
  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'title_body_required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: admins, error: adminErr } = await supabase
    .from('profiles')
    .select('app_user_id')
    .eq('admin', 'y')
    .not('fcm_token', 'is', null);

  if (adminErr) {
    return new Response(JSON.stringify({ error: adminErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const toUserIds = (admins ?? [])
    .map((r) => String((r as { app_user_id?: string }).app_user_id ?? '').trim())
    .filter(Boolean);

  if (toUserIds.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no_admin_tokens' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const isUrgent = payload.priority === 'urgent';
  const path = String(payload.path ?? '/reports').trim();
  const data: Record<string, string> = isUrgent
    ? {
        action: 'admin_open',
        priority: 'urgent',
        path,
        title,
        body,
        ...(payload.reportId ? { report_id: payload.reportId } : {}),
      }
    : {
        action: 'admin_message',
        path,
        title,
        body,
      };

  const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('fcm-push-send', {
    body: { toUserIds, title, body, data },
  });

  if (invokeErr) {
    return new Response(JSON.stringify({ error: invokeErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, toUserIds: toUserIds.length, result: invokeData }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
