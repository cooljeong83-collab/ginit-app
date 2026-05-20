import { supabase } from '@/src/lib/supabase';
import { toUserFacingErrorMessage } from '@/src/lib/user-facing-error-message';

export type AccountSessionGateReason =
  | 'suspended'
  | 'withdrawn'
  | 'forbidden'
  | 'invalid_user'
  | string;

export type AccountSessionGateResult = {
  ok: boolean;
  reason?: AccountSessionGateReason;
  message?: string;
};

export async function fetchAccountSessionGate(appUserId: string): Promise<AccountSessionGateResult> {
  const id = appUserId.trim();
  if (!id) {
    return { ok: false, reason: 'invalid_user', message: '사용자 정보가 없습니다.' };
  }
  const { data, error } = await supabase.rpc('get_account_session_gate', {
    p_app_user_id: id,
  });
  if (error) {
    return { ok: false, reason: 'rpc_error', message: toUserFacingErrorMessage(error.message) };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: 'invalid_response' };
  }
  const row = data as Record<string, unknown>;
  return {
    ok: Boolean(row.ok),
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    message: typeof row.message === 'string' ? row.message : undefined,
  };
}
