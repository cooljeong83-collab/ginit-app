-- 탈퇴 익명화 전용 RPC.
-- profiles metric fields(g_level/g_xp/g_trust 등)는 클라이언트 payload로 직접 갱신하지 않고,
-- security-definer RPC 내부에서만 metric guard를 우회해 처리합니다.

create or replace function public.withdraw_anonymize_profile(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  perform set_config('ginit.skip_profile_metric_guard', '1', true);
  perform public.ensure_profile_minimal(p_app_user_id);

  update public.profiles p
  set
    updated_at = now(),
    is_withdrawn = true,
    nickname = '(탈퇴한 회원)',
    withdrawn_at = now(),

    -- 개인정보/인증/동의/프로필성 정보는 모두 null 처리합니다.
    photo_url = null,
    bio = null,
    phone = null,
    phone_verified_at = null,
    email = null,
    display_name = null,
    fcm_token = null,
    fcm_platform = null,
    terms_agreed_at = null,
    gender = null,
    age_band = null,
    birth_year = null,
    birth_month = null,
    birth_day = null,
    signup_provider = null,

    -- G-Trust는 탈퇴 후에도 보존합니다.
    g_level = 1,
    g_xp = 0,

    -- private 계정 플래그는 운영상 의미가 없으므로 기본값으로 되돌립니다.
    is_private = false,
    metadata = '{}'::jsonb
  where p.app_user_id = trim(p_app_user_id);
end;
$$;

revoke all on function public.withdraw_anonymize_profile(text) from public;
grant execute on function public.withdraw_anonymize_profile(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
