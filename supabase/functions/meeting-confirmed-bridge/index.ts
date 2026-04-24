/**
 * Consumes `integration_outbox` rows (`firestore_chat_system_place_confirmed`) and
 * appends a Firestore system message under `meetings/{legacy_firestore_meeting_id}/messages`.
 *
 * Secrets: `FIREBASE_SERVICE_ACCOUNT_JSON` (full service account JSON string).
 * Uses auto-injected `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { cert, getApps, initializeApp } from 'npm:firebase-admin@12/app';
import { FieldValue, getFirestore } from 'npm:firebase-admin@12/firestore';

const OUTBOX_KIND = 'firestore_chat_system_place_confirmed';
const BATCH_LIMIT = 25;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getFirebaseAdmin() {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
  if (!raw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');
  }
  const cred = JSON.parse(raw) as Record<string, unknown>;
  if (!getApps().length) {
    initializeApp({ credential: cert(cred as never) });
  }
  return getFirestore();
}

function buildSystemText(payload: Record<string, unknown>): string {
  const place = typeof payload.place_name === 'string' ? payload.place_name.trim() : '';
  const date = typeof payload.schedule_date === 'string' ? payload.schedule_date.trim() : '';
  const time = typeof payload.schedule_time === 'string' ? payload.schedule_time.trim() : '';
  const bits: string[] = ['장소가 확정되었습니다'];
  if (place) bits.push(`· ${place}`);
  if (date || time) bits.push(`(${[date, time].filter(Boolean).join(' ')})`);
  return bits.join(' ');
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceRole) {
    return jsonResponse({ ok: false, error: 'Missing Supabase env' }, 500);
  }

  let firestore: ReturnType<typeof getFirestore>;
  try {
    firestore = getFirebaseAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ ok: false, error: msg }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: selErr } = await supabase
    .from('integration_outbox')
    .select('id, kind, payload')
    .is('processed_at', null)
    .eq('kind', OUTBOX_KIND)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (selErr) {
    return jsonResponse({ ok: false, error: selErr.message }, 500);
  }

  const list = rows ?? [];
  if (list.length === 0) {
    return jsonResponse({ ok: true, processed: 0 });
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const row of list) {
    const id = row.id as string;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const meetingId =
      typeof payload.legacy_firestore_meeting_id === 'string'
        ? payload.legacy_firestore_meeting_id.trim()
        : '';

    if (!meetingId) {
      const err = 'payload.legacy_firestore_meeting_id missing';
      await supabase.from('integration_outbox').update({ last_error: err }).eq('id', id);
      results.push({ id, ok: false, error: err });
      continue;
    }

    try {
      const text = buildSystemText(payload);
      await firestore.collection('meetings').doc(meetingId).collection('messages').add({
        kind: 'system',
        text,
        senderId: null,
        imageUrl: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      const { error: upErr } = await supabase
        .from('integration_outbox')
        .update({ processed_at: new Date().toISOString(), last_error: null })
        .eq('id', id);

      if (upErr) {
        results.push({ id, ok: false, error: upErr.message });
      } else {
        results.push({ id, ok: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from('integration_outbox').update({ last_error: msg }).eq('id', id);
      results.push({ id, ok: false, error: msg });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return jsonResponse({
    ok: true,
    processed: okCount,
    attempted: list.length,
    results,
  });
});
