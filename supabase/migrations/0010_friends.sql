-- 친구·매칭(지닛) 정적 데이터 — 클라이언트는 security definer RPC만 호출하는 것을 권장합니다.

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  requester_app_user_id text not null,
  addressee_app_user_id text not null,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friends_request_pair_ux unique (requester_app_user_id, addressee_app_user_id)
);

create index if not exists friends_addressee_pending_idx
  on public.friends (addressee_app_user_id)
  where status = 'pending';

create index if not exists friends_participant_accepted_idx
  on public.friends (requester_app_user_id, addressee_app_user_id)
  where status = 'accepted';

drop trigger if exists trg_friends_touch on public.friends;
create trigger trg_friends_touch
before update on public.friends
for each row execute function public.touch_updated_at();

alter table public.friends enable row level security;

-- ─── RPC ─────────────────────────────────────────────────────────────

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
    where f.addressee_app_user_id = trim(p_me)
      and f.status = 'pending'
    order by f.created_at desc
  ) s;
$$;

revoke all on function public.friends_pending_inbox(text) from public;
grant execute on function public.friends_pending_inbox(text) to anon, authenticated;

create or replace function public.friends_accepted_list(p_me text)
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
      'peer_app_user_id',
        case
          when f.requester_app_user_id = trim(p_me) then f.addressee_app_user_id
          else f.requester_app_user_id
        end,
      'status', f.status,
      'updated_at', f.updated_at
    ) as e
    from public.friends f
    where f.status = 'accepted'
      and (f.requester_app_user_id = trim(p_me) or f.addressee_app_user_id = trim(p_me))
    order by f.updated_at desc
  ) s;
$$;

revoke all on function public.friends_accepted_list(text) from public;
grant execute on function public.friends_accepted_list(text) to anon, authenticated;

create or replace function public.friends_send_ginit(p_requester text, p_addressee text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  r text := trim(p_requester);
  a text := trim(p_addressee);
begin
  if r = '' or a = '' or r = a then
    raise exception 'invalid pair';
  end if;
  insert into public.friends (requester_app_user_id, addressee_app_user_id, status)
  values (r, a, 'pending')
  on conflict (requester_app_user_id, addressee_app_user_id) do nothing
  returning id into v_id;
  if v_id is null then
    select f.id into v_id
    from public.friends f
    where f.requester_app_user_id = r and f.addressee_app_user_id = a
    limit 1;
  end if;
  return v_id;
end;
$$;

revoke all on function public.friends_send_ginit(text, text) from public;
grant execute on function public.friends_send_ginit(text, text) to anon, authenticated;

create or replace function public.friends_accept(p_me text, p_friendship_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friends f
  set status = 'accepted', updated_at = now()
  where f.id = p_friendship_id
    and f.addressee_app_user_id = trim(p_me)
    and f.status = 'pending';
  if not found then
    raise exception 'not found or not allowed';
  end if;
end;
$$;

revoke all on function public.friends_accept(text, uuid) from public;
grant execute on function public.friends_accept(text, uuid) to anon, authenticated;
