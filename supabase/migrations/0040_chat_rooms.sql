-- DM 채팅방 요약(1:1). 동기화 소스는 별도(워커/앱); 목록은 RPC로 페이지 조회.
create table if not exists public.chat_rooms (
  id text primary key,
  participant_ids text[] not null check (cardinality(participant_ids) >= 2),
  is_group boolean not null default false,
  last_message_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists chat_rooms_participant_ids_gin
  on public.chat_rooms using gin (participant_ids);

create index if not exists chat_rooms_list_order_idx
  on public.chat_rooms (coalesce(last_message_at, updated_at) desc nulls last, id desc);

alter table public.chat_rooms enable row level security;

drop policy if exists chat_rooms_block_direct on public.chat_rooms;
create policy chat_rooms_block_direct on public.chat_rooms
for all to anon, authenticated using (false);

-- p_page: 0부터. 내부적으로 limit 21 / offset p_page*20 → has_more
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
  cand as (
    select c.id, c.participant_ids
    from public.chat_rooms c, me
    where me.uid is not null
      and c.is_group = false
      and c.participant_ids @> array[me.uid]::text[]
    order by coalesce(c.last_message_at, c.updated_at) desc nulls last, c.id desc
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
              'peerAppUserId', coalesce(
                (
                  select p
                  from unnest(n.participant_ids) as p
                  where p <> (select uid from me)
                  limit 1
                ),
                ''
              )
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

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_rooms'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_rooms';
  end if;
end $$;
