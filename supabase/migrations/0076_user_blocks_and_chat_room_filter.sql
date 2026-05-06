-- 0076: user blocks (server-synced) + chat room list filtering
--
-- Goal:
-- - 친구 차단을 서버(Supabase)에 저장해 기기/플랫폼과 무관하게 일관되게 적용
-- - 차단 관계가 있으면 1:1 채팅방 목록에서 제외 (soft-hide)
-- - 푸시 발송 필터링은 Edge Function에서 처리(별도 코드)

create table if not exists public.user_blocks (
  blocker_app_user_id text not null,
  blocked_app_user_id text not null,
  created_at timestamptz not null default now(),
  constraint user_blocks_pk primary key (blocker_app_user_id, blocked_app_user_id),
  constraint user_blocks_no_self_block check (lower(trim(blocker_app_user_id)) <> lower(trim(blocked_app_user_id)))
);

create index if not exists user_blocks_blocker_idx on public.user_blocks (lower(trim(blocker_app_user_id)));
create index if not exists user_blocks_blocked_idx on public.user_blocks (lower(trim(blocked_app_user_id)));

alter table public.user_blocks enable row level security;

drop policy if exists user_blocks_select_own on public.user_blocks;
create policy user_blocks_select_own on public.user_blocks
for select to anon, authenticated
using (lower(trim(blocker_app_user_id)) = lower(trim(coalesce(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''))));

drop policy if exists user_blocks_insert_own on public.user_blocks;
create policy user_blocks_insert_own on public.user_blocks
for insert to anon, authenticated
with check (lower(trim(blocker_app_user_id)) = lower(trim(coalesce(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''))));

drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_delete_own on public.user_blocks
for delete to anon, authenticated
using (lower(trim(blocker_app_user_id)) = lower(trim(coalesce(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''))));

-- RPC: block/unblock/list/is_blocked

create or replace function public.user_blocks_block(p_me text, p_peer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me text := nullif(trim(coalesce(p_me, '')), '');
  peer text := nullif(trim(coalesce(p_peer, '')), '');
begin
  if me is null or peer is null then
    raise exception 'invalid_user_id';
  end if;
  if lower(me) = lower(peer) then
    raise exception 'cannot_block_self';
  end if;
  insert into public.user_blocks (blocker_app_user_id, blocked_app_user_id)
  values (me, peer)
  on conflict (blocker_app_user_id, blocked_app_user_id) do update
    set created_at = excluded.created_at;
end;
$$;

revoke all on function public.user_blocks_block(text, text) from public;
grant execute on function public.user_blocks_block(text, text) to anon, authenticated;

create or replace function public.user_blocks_unblock(p_me text, p_peer text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_blocks ub
  where lower(trim(ub.blocker_app_user_id)) = lower(trim(coalesce(p_me, '')))
    and lower(trim(ub.blocked_app_user_id)) = lower(trim(coalesce(p_peer, '')));
$$;

revoke all on function public.user_blocks_unblock(text, text) from public;
grant execute on function public.user_blocks_unblock(text, text) to anon, authenticated;

create or replace function public.user_blocks_list(p_me text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'blocked_app_user_id', ub.blocked_app_user_id,
        'created_at', ub.created_at
      ) order by ub.created_at desc)
      from public.user_blocks ub
      where lower(trim(ub.blocker_app_user_id)) = lower(trim(coalesce(p_me, '')))
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.user_blocks_list(text) from public;
grant execute on function public.user_blocks_list(text) to anon, authenticated;

-- IMPORTANT: 상대가 나를 차단했는지(역방향)를 클라이언트가 알 수 없게,
-- "내가 상대를 차단했는지"만 확인 가능한 단방향 함수로 둡니다.
create or replace function public.user_blocks_is_blocked(p_me text, p_peer text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.user_blocks ub
    where lower(trim(ub.blocker_app_user_id)) = lower(trim(coalesce(p_me, '')))
      and lower(trim(ub.blocked_app_user_id)) = lower(trim(coalesce(p_peer, '')))
  );
$$;

revoke all on function public.user_blocks_is_blocked(text, text) from public;
grant execute on function public.user_blocks_is_blocked(text, text) to anon, authenticated;

-- Update chat room list RPC to exclude peers that I blocked (one-way),
-- so the blocked user cannot infer they've been blocked just because the room vanished.
create or replace function public.chat_rooms_list_page(p_me text, p_page int)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select nullif(trim(coalesce(p_me, '')), '') as uid,
           greatest(coalesce(p_page, 0), 0) * 20 as off
  ),
  cand0 as (
    select c.id, c.participant_ids
    from public.chat_rooms c, me
    where me.uid is not null
      and c.is_group = false
      and c.participant_ids @> array[me.uid]::text[]
  ),
  cand_peers as (
    select
      c.id,
      c.participant_ids,
      coalesce(
        (
          select p
          from unnest(c.participant_ids) as p
          where lower(trim(p)) <> lower(trim((select uid from me)))
          limit 1
        ),
        ''
      ) as peer
    from cand0 c
  ),
  cand as (
    select cp.*
    from cand_peers cp, me m
    where m.uid is not null
      and not exists (
        select 1
        from public.user_blocks ub
        where lower(trim(ub.blocker_app_user_id)) = lower(trim(m.uid))
          and lower(trim(ub.blocked_app_user_id)) = lower(trim(cp.peer))
      )
    order by (
      select coalesce(cr.last_message_at, cr.updated_at)
      from public.chat_rooms cr
      where cr.id = cp.id
      limit 1
    ) desc nulls last, cp.id desc
    limit 21 offset (select m.off from me m)
  ),
  numbered as (
    select *, row_number() over (order by id desc) as rn from cand
  )
  select jsonb_build_object(
    'rooms',
    coalesce(
      (
        select jsonb_agg(x.obj order by x.rn)
        from (
          select n.rn,
            jsonb_build_object(
              'roomId', n.id,
              'peerAppUserId', n.peer
            ) as obj
          from numbered n
          where n.rn <= 20
        ) x
      ),
      '[]'::jsonb
    ),
    'has_more',
    (select count(*) > 20 from numbered)
  );
$$;

revoke all on function public.chat_rooms_list_page(text, int) from public;
grant execute on function public.chat_rooms_list_page(text, int) to anon, authenticated;

notify pgrst, 'reload schema';

