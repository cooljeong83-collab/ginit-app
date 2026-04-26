-- 내가 요청자인 지닛 전체 내역: pending + 내가 보낸 뒤 수락된 행(요청 시각 순)

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
      'created_at', f.created_at,
      'updated_at', f.updated_at
    ) as e
    from public.friends f
    where f.status in ('pending', 'accepted')
      and (
        case
          when position('@' in trim(coalesce(p_me, ''))) > 0 then
            lower(trim(f.requester_app_user_id)) = lower(trim(p_me))
          else trim(f.requester_app_user_id) = trim(p_me)
        end
      )
    order by f.created_at desc
  ) s;
$$;

revoke all on function public.friends_pending_outbox(text) from public;
grant execute on function public.friends_pending_outbox(text) to anon, authenticated;

notify pgrst, 'reload schema';
