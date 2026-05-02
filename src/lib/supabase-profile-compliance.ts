import { supabase } from '@/src/lib/supabase';

export type MeetingComplianceSyncInput = {
  appUserId: string;
  nickname: string;
  /** 비어 있으면 Supabase `profiles.phone`은 null로 반영 */
  phoneE164: string;
  /** null이면 `phone_verified_at`를 null로 반영(전화 인증 생략 모드) */
  phoneVerifiedAtIso: string | null;
  termsAgreedAtIso: string;
};

export type MeetingDemographicsSyncInput = {
  appUserId: string;
  gender: 'MALE' | 'FEMALE';
  birthYear: number;
  birthMonth: number;
  birthDay: number;
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

/**
 * Supabase `profiles`에 성별·생년월일을 반영합니다.
 * `upsert_profile_meeting_demographics` RPC가 배포되어 있어야 합니다.
 */
export async function syncMeetingDemographicsToSupabase(
  input: MeetingDemographicsSyncInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('upsert_profile_meeting_demographics', {
    p_app_user_id: input.appUserId.trim(),
    p_gender: input.gender,
    p_birth_year: input.birthYear,
    p_birth_month: input.birthMonth,
    p_birth_day: input.birthDay,
  });
  if (error) {
    return { ok: false, message: error.message || 'Supabase 동기화에 실패했습니다.' };
  }
  return { ok: true };
}
