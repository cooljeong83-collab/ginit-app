-- 내가 요청자인 pending 지닛 목록(보낸 요청)

create or replace function public.friends_pending_outbox(p_me text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', f.id,
      'requester_app_user_id', f.requester_app_user_id,
      'addressee_app_user_id', f.addressee_app_user_id,
      'status', f.status,
      'created_at', f.created_at
    ) as e
    from public.friends f
    where f.requester_app_user_id = trim(p_me)
      and f.status = 'pending'
    order by f.created_at desc
  ) s;
$$;

revoke all on function public.friends_pending_outbox(text) from public;
grant execute on function public.friends_pending_outbox(text) to anon, authenticated;

notify pgrst, 'reload schema';
