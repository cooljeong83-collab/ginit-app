-- friends_relation_status: (me,peer) 쌍에 여러 friends 행이 있을 때
-- updated_at 기준 limit 1 한 행만 보면 accepted보다 최근 pending이 먼저 잡혀
-- 친구인데 관계 없음/잘못된 pending으로 보이는 문제가 생길 수 있음.
-- accepted > 내가 보낸 pending > 받은 pending > none 우선순위로 집계한다.

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
  c as (
    select f.*
    from public.friends f, params p
    where (f.requester_app_user_id = p.me and f.addressee_app_user_id = p.peer)
       or (f.requester_app_user_id = p.peer and f.addressee_app_user_id = p.me)
  ),
  acc as (
    select *
    from c
    where status = 'accepted'
    order by updated_at desc nulls last, created_at desc
    limit 1
  ),
  po as (
    select *
    from c, params p
    where c.status = 'pending'
      and c.requester_app_user_id = p.me
      and c.addressee_app_user_id = p.peer
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1
  ),
  pi as (
    select *
    from c, params p
    where c.status = 'pending'
      and c.requester_app_user_id = p.peer
      and c.addressee_app_user_id = p.me
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1
  )
  select jsonb_build_object(
    'status',
      case
        when (select me from params) = '' or (select peer from params) = '' then 'none'
        when exists (select 1 from acc) then 'accepted'
        when exists (select 1 from po) then 'pending_out'
        when exists (select 1 from pi) then 'pending_in'
        else 'none'
      end,
    'friendship_id',
      case
        when (select me from params) = '' or (select peer from params) = '' then null
        when exists (select 1 from acc) then (select id from acc)
        when exists (select 1 from po) then (select id from po)
        when exists (select 1 from pi) then (select id from pi)
        else null
      end,
    'requester_app_user_id',
      case
        when (select me from params) = '' or (select peer from params) = '' then null
        when exists (select 1 from acc) then (select requester_app_user_id from acc)
        when exists (select 1 from po) then (select requester_app_user_id from po)
        when exists (select 1 from pi) then (select requester_app_user_id from pi)
        else null
      end,
    'addressee_app_user_id',
      case
        when (select me from params) = '' or (select peer from params) = '' then null
        when exists (select 1 from acc) then (select addressee_app_user_id from acc)
        when exists (select 1 from po) then (select addressee_app_user_id from po)
        when exists (select 1 from pi) then (select addressee_app_user_id from pi)
        else null
      end
  );
$$;

revoke all on function public.friends_relation_status(text, text) from public;
grant execute on function public.friends_relation_status(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
