-- 요청자가 보낸 대기(pending) 지닛 요청을 취소(행 삭제)합니다.

create or replace function public.friends_cancel_outgoing(p_me text, p_friendship_id uuid)
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
    and f.status = 'pending'
    and (
      case
        when position('@' in trim(coalesce(p_me, ''))) > 0 then
          lower(trim(f.requester_app_user_id)) = lower(trim(p_me))
        else trim(f.requester_app_user_id) = trim(p_me)
      end
    );
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'not found or not allowed';
  end if;
end;
$$;

revoke all on function public.friends_cancel_outgoing(text, uuid) from public;
grant execute on function public.friends_cancel_outgoing(text, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
