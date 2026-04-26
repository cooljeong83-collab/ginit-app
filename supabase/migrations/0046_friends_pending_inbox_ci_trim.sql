-- 수신/발신 지닛 목록: 컬럼·인자 모두 trim + 이메일 대소문자 무시 매칭
-- (friends 행은 들어가는데 RPC가 빈 배열을 주면 인박스·알람이 비는 문제 방지)

create or replace function public.friends_pending_inbox(p_me text)
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
    where lower(trim(f.addressee_app_user_id)) = lower(trim(p_me))
      and f.status = 'pending'
    order by f.created_at desc
  ) s;
$$;

revoke all on function public.friends_pending_inbox(text) from public;
grant execute on function public.friends_pending_inbox(text) to anon, authenticated;

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
    where lower(trim(f.requester_app_user_id)) = lower(trim(p_me))
      and f.status = 'pending'
    order by f.created_at desc
  ) s;
$$;

revoke all on function public.friends_pending_outbox(text) from public;
grant execute on function public.friends_pending_outbox(text) to anon, authenticated;

notify pgrst, 'reload schema';
