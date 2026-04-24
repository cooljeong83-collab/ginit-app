-- 모임 이용 인증(전화·약관)을 Supabase profiles에 반영하기 위한 RPC.
-- 앱은 Firebase Auth를 쓰므로 RLS(auth.uid) 기반 직접 UPDATE가 어렵습니다.
-- 운영 환경에서는 Edge Function + Firebase 토큰 검증 등으로 이 RPC를 대체·보강하는 것을 권장합니다.

create or replace function public.upsert_profile_meeting_compliance(
  p_app_user_id text,
  p_nickname text,
  p_phone text,
  p_phone_verified_at timestamptz,
  p_terms_agreed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := coalesce(nullif(trim(p_nickname), ''), '회원');
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  insert into public.profiles (app_user_id, nickname, phone, phone_verified_at, terms_agreed_at)
  values (trim(p_app_user_id), v_nick, nullif(trim(p_phone), ''), p_phone_verified_at, p_terms_agreed_at)
  on conflict (app_user_id) do update
  set
    nickname = coalesce(nullif(trim(excluded.nickname), ''), public.profiles.nickname),
    phone = excluded.phone,
    phone_verified_at = excluded.phone_verified_at,
    terms_agreed_at = coalesce(excluded.terms_agreed_at, public.profiles.terms_agreed_at),
    updated_at = now();
end;
$$;

revoke all on function public.upsert_profile_meeting_compliance(text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.upsert_profile_meeting_compliance(text, text, text, timestamptz, timestamptz) to anon, authenticated;
