-- PostgREST가 RPC를 아직 노출하지 않을 때 재적용용(본문은 0012와 동일).
-- 원격 프로젝트에 0012만 적용됐는데 캐시가 꼬인 경우 `supabase db push`로 재실행하세요.

create or replace function public.ensure_profile_minimal(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := '모임친구' || substr(md5(random()::text), 1, 6);
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;
  insert into public.profiles (app_user_id, nickname)
  values (trim(p_app_user_id), v_nick)
  on conflict (app_user_id) do nothing;
end;
$$;

revoke all on function public.ensure_profile_minimal(text) from public;
grant execute on function public.ensure_profile_minimal(text) to anon, authenticated;

notify pgrst, 'reload schema';
