import { supabase } from '@/src/lib/supabase';

const RPC_SCHEMA_CACHE_RETRY_WAITS_MS = [0, 800, 2500, 6000, 14_000] as const;

function isPostgrestSchemaCacheOrMissingRpcError(message: string, code?: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('schema cache')) return true;
  if (m.includes('could not find the function')) return true;
  if (code === 'PGRST202' || code === '42883') return true;
  return false;
}

export type MeetingAreaNotifyMatrix = {
  region_norms: string[];
  category_ids: string[];
};

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = typeof x === 'string' ? x.trim() : String(x ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function parseMatrixJson(data: unknown): MeetingAreaNotifyMatrix {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { region_norms: [], category_ids: [] };
  }
  const o = data as Record<string, unknown>;
  return {
    region_norms: parseStringArray(o.region_norms),
    category_ids: parseStringArray(o.category_ids),
  };
}

export async function fetchMeetingAreaNotifyMatrix(appUserId: string): Promise<MeetingAreaNotifyMatrix> {
  const id = appUserId.trim();
  if (!id) return { region_norms: [], category_ids: [] };
  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { data, error } = await supabase.rpc('get_meeting_area_notify_matrix', { p_app_user_id: id });
    if (!error) return parseMatrixJson(data);
    lastMessage = error.message?.trim() || 'get_meeting_area_notify_matrix failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    if (__DEV__) console.warn('[meeting-area-notify-rules] get matrix', lastMessage);
    const retryable = isPostgrestSchemaCacheOrMissingRpcError(lastMessage, code);
    if (!retryable || i === RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length - 1) {
      return { region_norms: [], category_ids: [] };
    }
  }
  return { region_norms: [], category_ids: [] };
}

export async function replaceMeetingAreaNotifyMatrix(
  appUserId: string,
  regionNorms: string[],
  categoryIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = appUserId.trim();
  if (!id) return { ok: false, message: 'app_user_id required' };
  let lastMessage = '';
  for (let i = 0; i < RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length; i += 1) {
    const wait = RPC_SCHEMA_CACHE_RETRY_WAITS_MS[i]!;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { error } = await supabase.rpc('replace_meeting_area_notify_matrix', {
      p_app_user_id: id,
      p_region_norms: regionNorms,
      p_category_ids: categoryIds,
    });
    if (!error) return { ok: true };
    lastMessage = error.message?.trim() || 'replace_meeting_area_notify_matrix failed';
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    if (__DEV__) console.warn('[meeting-area-notify-rules] replace matrix', lastMessage);
    const retryable = isPostgrestSchemaCacheOrMissingRpcError(lastMessage, code);
    if (!retryable || i === RPC_SCHEMA_CACHE_RETRY_WAITS_MS.length - 1) {
      return { ok: false, message: lastMessage };
    }
  }
  return { ok: false, message: lastMessage || 'replace_meeting_area_notify_matrix failed' };
}
