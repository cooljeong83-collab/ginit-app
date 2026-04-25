-- 신규 프로필의 g_trust: 테이블 default(100) 고정이 아니라
-- app_policies trust.default_score(비활성 시 get_policy_numeric 폴백)를 반영합니다.

create or replace function public.ensure_profile_minimal(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := '모임친구' || substr(md5(random()::text), 1, 6);
  v_initial_trust int;
  v_raw numeric;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  v_raw := public.get_policy_numeric('trust', 'default_score', 100::numeric);
  v_initial_trust := least(100, greatest(0, round(coalesce(v_raw, 100::numeric))::int));

  insert into public.profiles (app_user_id, nickname, g_trust)
  values (trim(p_app_user_id), v_nick, v_initial_trust)
  on conflict (app_user_id) do nothing;
end;
$$;

revoke all on function public.ensure_profile_minimal(text) from public;
grant execute on function public.ensure_profile_minimal(text) to anon, authenticated;

notify pgrst, 'reload schema';

update public.app_policies
set description = '신규 가입 시 profiles.g_trust 초기값(ensure_profile_minimal, 0~100 클램프)',
    updated_at = now()
where policy_group = 'trust' and policy_key = 'default_score';
