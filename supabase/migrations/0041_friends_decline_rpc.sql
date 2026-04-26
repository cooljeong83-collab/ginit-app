-- 수신자가 대기(pending) 지닛 요청을 거절(행 삭제)합니다.

create or replace function public.friends_decline(p_me text, p_friendship_id uuid)
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
    and f.addressee_app_user_id = trim(p_me)
    and f.status = 'pending';
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not found or not allowed';
  end if;
end;
$$;

revoke all on function public.friends_decline(text, uuid) from public;
grant execute on function public.friends_decline(text, uuid) to anon, authenticated;
