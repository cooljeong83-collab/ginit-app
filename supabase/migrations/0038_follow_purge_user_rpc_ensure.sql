-- 0037과 동일(멱등). 일부 환경에서 0037 미적용·PostgREST 스키마 캐시 불일치 시 재적용용.

create or replace function public.follow_purge_user(p_me text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := trim(p_me);
begin
  if me = '' then
    raise exception 'me required';
  end if;

  delete from public.user_follows uf
  where uf.follower_app_user_id = me
     or uf.followee_app_user_id = me;
end;
$$;

revoke all on function public.follow_purge_user(text) from public;
grant execute on function public.follow_purge_user(text) to anon, authenticated;

notify pgrst, 'reload schema';
