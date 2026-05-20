import { supabase } from '@/src/lib/supabase';

export type AdminSessionGateResult = {
  ok: boolean;
  admin: boolean;
  reason?: string;
  hint?: string;
  profile?: {
    id: string;
    nickname?: string | null;
    app_user_id?: string | null;
    email?: string | null;
  };
};

export async function fetchAdminSessionGate(): Promise<AdminSessionGateResult> {
  const { data, error } = await supabase.rpc('admin_get_session_gate');
  if (error) {
    return { ok: false, admin: false, reason: 'rpc_error', hint: error.message };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, admin: false, reason: 'invalid_response' };
  }
  const row = data as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    admin: Boolean(row.admin),
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    hint: typeof row.hint === 'string' ? row.hint : undefined,
    profile:
      row.profile && typeof row.profile === 'object'
        ? (row.profile as AdminSessionGateResult['profile'])
        : undefined,
  };
}
