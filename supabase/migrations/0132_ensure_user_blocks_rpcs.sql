-- 0132: Ensure user_blocks table + RPCs exist on DBs that skipped 0076 in migration history.
-- Idempotent: safe if 0076 already applied.

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

-- Replace stubs or legacy arg names (42P13 if parameter names differ).
drop function if exists public.user_blocks_is_blocked(text, text);
drop function if exists public.user_blocks_list(text);
drop function if exists public.user_blocks_unblock(text, text);
drop function if exists public.user_blocks_block(text, text);

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

notify pgrst, 'reload schema';
