-- Instagram-style follow system (public/private + follow requests)

-- 1) profiles privacy
alter table public.profiles
add column if not exists is_private boolean not null default false;

create index if not exists profiles_is_private_idx on public.profiles (is_private);

-- 2) user_follows (directed)
create table if not exists public.user_follows (
  id uuid primary key default gen_random_uuid(),
  follower_app_user_id text not null,
  followee_app_user_id text not null,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_follows_pair_ux unique (follower_app_user_id, followee_app_user_id)
);

create index if not exists user_follows_follower_idx on public.user_follows (follower_app_user_id);
create index if not exists user_follows_followee_idx on public.user_follows (followee_app_user_id);
create index if not exists user_follows_followee_pending_idx
  on public.user_follows (followee_app_user_id)
  where status = 'pending';

drop trigger if exists trg_user_follows_touch on public.user_follows;
create trigger trg_user_follows_touch
before update on public.user_follows
for each row execute function public.touch_updated_at();

alter table public.user_follows enable row level security;

-- select is via RPC only; keep table private by default
revoke all on table public.user_follows from anon, authenticated;

-- ─── RPC ─────────────────────────────────────────────────────────────

-- send follow or follow request depending on followee privacy
create or replace function public.follow_send_request(p_follower text, p_followee text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  f text := trim(p_follower);
  e text := trim(p_followee);
  v_private boolean := false;
  v_status text := 'accepted';
begin
  if f = '' or e = '' or f = e then
    raise exception 'invalid pair';
  end if;

  select coalesce(p.is_private, false) into v_private
  from public.profiles p
  where p.app_user_id = e
  limit 1;

  v_status := case when v_private is true then 'pending' else 'accepted' end;

  insert into public.user_follows (follower_app_user_id, followee_app_user_id, status)
  values (f, e, v_status)
  on conflict (follower_app_user_id, followee_app_user_id)
  do update set status = excluded.status, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.follow_send_request(text, text) from public;
grant execute on function public.follow_send_request(text, text) to anon, authenticated;

-- accept pending request (followee approves)
create or replace function public.follow_accept(p_me text, p_follow_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_follows uf
  set status = 'accepted', updated_at = now()
  where uf.id = p_follow_id
    and uf.followee_app_user_id = trim(p_me)
    and uf.status = 'pending';
  if not found then
    raise exception 'not found or not allowed';
  end if;
end;
$$;

revoke all on function public.follow_accept(text, uuid) from public;
grant execute on function public.follow_accept(text, uuid) to anon, authenticated;

-- reject pending request (followee rejects)
create or replace function public.follow_reject(p_me text, p_follow_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_follows uf
  where uf.id = p_follow_id
    and uf.followee_app_user_id = trim(p_me)
    and uf.status = 'pending';
  if not found then
    raise exception 'not found or not allowed';
  end if;
end;
$$;

revoke all on function public.follow_reject(text, uuid) from public;
grant execute on function public.follow_reject(text, uuid) to anon, authenticated;

-- unfollow / cancel request (follower removes)
create or replace function public.follow_unfollow(p_follower text, p_followee text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_follows uf
  where uf.follower_app_user_id = trim(p_follower)
    and uf.followee_app_user_id = trim(p_followee);
end;
$$;

revoke all on function public.follow_unfollow(text, text) from public;
grant execute on function public.follow_unfollow(text, text) to anon, authenticated;

-- relation status for UI
create or replace function public.follow_relation_status(p_me text, p_peer text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select trim(p_me) as me, trim(p_peer) as peer
  ),
  out_rel as (
    select uf.*
    from public.user_follows uf, params p
    where uf.follower_app_user_id = p.me
      and uf.followee_app_user_id = p.peer
    limit 1
  ),
  in_rel as (
    select uf.*
    from public.user_follows uf, params p
    where uf.follower_app_user_id = p.peer
      and uf.followee_app_user_id = p.me
    limit 1
  )
  select jsonb_build_object(
    'status',
      case
        when (select me from params) = '' or (select peer from params) = '' then 'none'
        when exists (select 1 from out_rel o where o.status = 'accepted')
          and exists (select 1 from in_rel i where i.status = 'accepted') then 'mutual'
        when exists (select 1 from out_rel o where o.status = 'accepted') then 'following'
        when exists (select 1 from out_rel o where o.status = 'pending') then 'requested_out'
        when exists (select 1 from in_rel i where i.status = 'pending') then 'requested_in'
        when exists (select 1 from in_rel i where i.status = 'accepted') then 'follower'
        else 'none'
      end,
    'out_id', (select o.id from out_rel o limit 1),
    'in_id', (select i.id from in_rel i limit 1)
  );
$$;

revoke all on function public.follow_relation_status(text, text) from public;
grant execute on function public.follow_relation_status(text, text) to anon, authenticated;

-- lists
create or replace function public.follow_following_list(p_me text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', uf.id,
      'peer_app_user_id', uf.followee_app_user_id,
      'status', uf.status,
      'updated_at', uf.updated_at
    ) as e
    from public.user_follows uf
    where uf.follower_app_user_id = trim(p_me)
      and uf.status = 'accepted'
    order by uf.updated_at desc
  ) s;
$$;

revoke all on function public.follow_following_list(text) from public;
grant execute on function public.follow_following_list(text) to anon, authenticated;

create or replace function public.follow_followers_list(p_me text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', uf.id,
      'peer_app_user_id', uf.follower_app_user_id,
      'status', uf.status,
      'updated_at', uf.updated_at
    ) as e
    from public.user_follows uf
    where uf.followee_app_user_id = trim(p_me)
      and uf.status = 'accepted'
    order by uf.updated_at desc
  ) s;
$$;

revoke all on function public.follow_followers_list(text) from public;
grant execute on function public.follow_followers_list(text) to anon, authenticated;

create or replace function public.follow_pending_inbox(p_me text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', uf.id,
      'requester_app_user_id', uf.follower_app_user_id,
      'status', uf.status,
      'created_at', uf.created_at
    ) as e
    from public.user_follows uf
    where uf.followee_app_user_id = trim(p_me)
      and uf.status = 'pending'
    order by uf.created_at desc
  ) s;
$$;

revoke all on function public.follow_pending_inbox(text) from public;
grant execute on function public.follow_pending_inbox(text) to anon, authenticated;

create or replace function public.follow_pending_outbox(p_me text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', uf.id,
      'addressee_app_user_id', uf.followee_app_user_id,
      'status', uf.status,
      'created_at', uf.created_at
    ) as e
    from public.user_follows uf
    where uf.follower_app_user_id = trim(p_me)
      and uf.status = 'pending'
    order by uf.created_at desc
  ) s;
$$;

revoke all on function public.follow_pending_outbox(text) from public;
grant execute on function public.follow_pending_outbox(text) to anon, authenticated;

notify pgrst, 'reload schema';

