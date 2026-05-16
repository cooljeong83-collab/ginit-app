-- `ensure_profile_minimal`이 `auth_user_id`를 채우지 않아 `profiles.auth_user_id`가 null로 남는 문제 수정.
-- Realtime `user_notifications` RLS·`auth.uid()` 기반 RLS가 동작하려면 로그인 사용자와 profiles 행이 연결되어야 합니다.

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
  v_key text := trim(p_app_user_id);
begin
  if p_app_user_id is null or v_key = '' then
    raise exception 'app_user_id required';
  end if;

  v_raw := public.get_policy_numeric('trust', 'default_score', 100::numeric);
  v_initial_trust := least(100, greatest(0, round(coalesce(v_raw, 100::numeric))::int));

  insert into public.profiles (app_user_id, nickname, g_trust, auth_user_id)
  values (
    v_key,
    v_nick,
    v_initial_trust,
    (case when auth.uid() is not null then auth.uid() else null end)
  )
  on conflict (app_user_id) do nothing;

  -- 기존 행(과거 RPC·마이그레이션)에 auth_user_id만 비어 있는 경우: 현재 JWT와 연결
  if auth.uid() is not null then
    if not exists (
      select 1
      from public.profiles q
      where q.auth_user_id = auth.uid()
        and trim(q.app_user_id) <> v_key
    ) then
      update public.profiles p
      set auth_user_id = auth.uid()
      where trim(p.app_user_id) = v_key
        and p.auth_user_id is null;
    end if;
  end if;
end;
$$;

revoke all on function public.ensure_profile_minimal(text) from public;
grant execute on function public.ensure_profile_minimal(text) to anon, authenticated;

notify pgrst, 'reload schema';
