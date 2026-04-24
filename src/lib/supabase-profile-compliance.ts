import { supabase } from '@/src/lib/supabase';

export type MeetingComplianceSyncInput = {
  appUserId: string;
  nickname: string;
  phoneE164: string;
  phoneVerifiedAtIso: string;
  termsAgreedAtIso: string;
};

/**
 * Supabase `profiles`에 전화·약관 동의 시각을 반영합니다.
 * `upsert_profile_meeting_compliance` RPC(마이그레이션 0003)가 배포되어 있어야 합니다.
 */
export async function syncMeetingComplianceToSupabase(input: MeetingComplianceSyncInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('upsert_profile_meeting_compliance', {
    p_app_user_id: input.appUserId.trim(),
    p_nickname: input.nickname.trim() || '회원',
    p_phone: input.phoneE164.trim(),
    p_phone_verified_at: input.phoneVerifiedAtIso,
    p_terms_agreed_at: input.termsAgreedAtIso,
  });
  if (error) {
    return { ok: false, message: error.message || 'Supabase 동기화에 실패했습니다.' };
  }
  return { ok: true };
}
