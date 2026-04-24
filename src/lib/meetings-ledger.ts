import { Timestamp } from 'firebase/firestore';

import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { supabase } from '@/src/lib/supabase';

/** Ledger 모임 ID: Supabase `meetings.id` (UUID v4). Firestore 자동 ID와 구분. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLedgerMeetingId(meetingId: string): boolean {
  if (!ledgerWritesToSupabase()) return false;
  return UUID_V4_RE.test(meetingId.trim());
}

function serializeValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as Timestamp).toMillis === 'function') {
    try {
      return new Date((v as Timestamp).toMillis()).toISOString();
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === 'object' && v.constructor === Object) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = serializeValue(val);
    }
    return o;
  }
  return v;
}

/** RPC `ledger_meeting_put_doc` / `ledger_meeting_create` 용 JSONB 직렬화 */
export function meetingDocToLedgerPayload(doc: Record<string, unknown>): Record<string, unknown> {
  return serializeValue(doc) as Record<string, unknown>;
}

function normalizeRpcCreatedAt(doc: Record<string, unknown>): Record<string, unknown> {
  const o = { ...doc };
  const ca = o.createdAt;
  if (typeof ca === 'string') {
    const dt = new Date(ca);
    if (Number.isFinite(dt.getTime())) o.createdAt = Timestamp.fromDate(dt);
  } else if (ca != null && typeof ca === 'object' && !Array.isArray(ca)) {
    const s = JSON.stringify(ca);
    const dt = new Date(s.replace(/^"|"$/g, ''));
    if (Number.isFinite(dt.getTime())) o.createdAt = Timestamp.fromDate(dt);
  }
  return o;
}

/** `ledger_meeting_get_doc` — 행 없으면 null */
export async function ledgerTryLoadMeetingDoc(meetingId: string): Promise<Record<string, unknown> | null> {
  const id = meetingId.trim();
  if (!id) return null;
  const { data, error } = await supabase.rpc('ledger_meeting_get_doc', { p_meeting_id: id });
  if (error) throw new Error(error.message);
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (Object.keys(row).length === 0) return null;
  return normalizeRpcCreatedAt(row);
}

export async function ledgerMeetingPutRawDoc(meetingId: string, doc: Record<string, unknown>): Promise<void> {
  const payload = meetingDocToLedgerPayload(doc);
  const { error } = await supabase.rpc('ledger_meeting_put_doc', {
    p_meeting_id: meetingId.trim(),
    p_doc: payload,
  });
  if (error) throw new Error(error.message);
}

export async function ledgerMeetingCreate(hostAppUserId: string, doc: Record<string, unknown>): Promise<string> {
  const payload = meetingDocToLedgerPayload(doc);
  const { data, error } = await supabase.rpc('ledger_meeting_create', {
    p_host_app_user_id: hostAppUserId.trim(),
    p_doc: payload,
  });
  if (error) throw new Error(error.message);
  if (data == null) throw new Error('ledger_meeting_create returned null');
  return String(data);
}

export async function ledgerMeetingDelete(meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('ledger_meeting_delete', { p_meeting_id: meetingId.trim() });
  if (error) throw new Error(error.message);
}
