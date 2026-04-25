-- 친구 관계 상태 조회(상세/팝업용)
-- - accepted: 친구
-- - pending_out: 내가 친구 요청을 보냄(친구 요청중)
-- - pending_in: 내가 받은 친구 요청(현재 상세 팝업에서는 '친구 요청중'으로 표기)
-- - none: 관계 없음

create or replace function public.friends_relation_status(p_me text, p_peer text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select trim(p_me) as me, trim(p_peer) as peer
  ),
  rel as (
    select f.*
    from public.friends f, params p
    where (f.requester_app_user_id = p.me and f.addressee_app_user_id = p.peer)
       or (f.requester_app_user_id = p.peer and f.addressee_app_user_id = p.me)
    order by f.updated_at desc nulls last, f.created_at desc
    limit 1
  )
  select jsonb_build_object(
    'status',
      case
        when (select me from params) = '' or (select peer from params) = '' then 'none'
        when exists (select 1 from rel r where r.status = 'accepted') then 'accepted'
        when exists (select 1 from rel r where r.status = 'pending' and r.requester_app_user_id = (select me from params)) then 'pending_out'
        when exists (select 1 from rel r where r.status = 'pending') then 'pending_in'
        else 'none'
      end,
    'friendship_id', (select r.id from rel r limit 1),
    'requester_app_user_id', (select r.requester_app_user_id from rel r limit 1),
    'addressee_app_user_id', (select r.addressee_app_user_id from rel r limit 1)
  );
$$;

revoke all on function public.friends_relation_status(text, text) from public;
grant execute on function public.friends_relation_status(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

