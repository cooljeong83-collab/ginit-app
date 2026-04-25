-- 회원 탈퇴: user_follows에서 me가 포함된 모든 관계 삭제.

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

