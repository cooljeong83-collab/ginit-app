-- 모임 이용 인증(성별·생년월일)을 Supabase profiles에 반영하기 위한 RPC.
-- Firebase Auth 기반 앱에서 RLS(auth.uid)로 직접 UPDATE가 어려워 security definer RPC를 사용합니다.

create or replace function public.upsert_profile_meeting_demographics(
  p_app_user_id text,
  p_gender text,
  p_birth_year int,
  p_birth_month int,
  p_birth_day int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;
  if p_gender is null or trim(p_gender) = '' then
    raise exception 'gender required';
  end if;
  if p_birth_year is null or p_birth_month is null or p_birth_day is null then
    raise exception 'birthdate required';
  end if;

  perform public.ensure_profile_minimal(p_app_user_id);

  update public.profiles p
  set
    updated_at = now(),
    gender = nullif(trim(p_gender), ''),
    birth_year = p_birth_year,
    birth_month = p_birth_month,
    birth_day = p_birth_day
  where p.app_user_id = trim(p_app_user_id);
end;
$$;

revoke all on function public.upsert_profile_meeting_demographics(text, text, int, int, int) from public;
grant execute on function public.upsert_profile_meeting_demographics(text, text, int, int, int) to anon, authenticated;

notify pgrst, 'reload schema';

