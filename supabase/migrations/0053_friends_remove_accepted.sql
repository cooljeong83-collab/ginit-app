-- 수락된 지닛 친구 관계를 한쪽에서 삭제합니다(`friends` 행 삭제).

create or replace function public.friends_remove_accepted(p_me text, p_friendship_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.friends f
  where f.id = p_friendship_id
    and f.status = 'accepted'
    and (f.requester_app_user_id = trim(p_me) or f.addressee_app_user_id = trim(p_me));
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not found or not allowed';
  end if;
end;
$$;

revoke all on function public.friends_remove_accepted(text, uuid) from public;
grant execute on function public.friends_remove_accepted(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
