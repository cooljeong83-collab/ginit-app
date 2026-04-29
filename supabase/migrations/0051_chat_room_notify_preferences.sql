-- Per-user / per-room chat notification preference.
-- Default behavior is ON when no row exists.

create table if not exists public.chat_room_notify_preferences (
  app_user_id text not null,
  room_id text not null,
  notify_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_user_id, room_id)
);

create index if not exists chat_room_notify_preferences_room_idx
  on public.chat_room_notify_preferences (room_id);

alter table public.chat_room_notify_preferences enable row level security;

-- Clients use security-definer RPCs; direct table access is not granted.
revoke all on public.chat_room_notify_preferences from public;

create or replace function public.get_chat_room_notify_enabled(
  p_app_user_id text,
  p_room_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    return true;
  end if;
  if p_room_id is null or trim(p_room_id) = '' then
    return true;
  end if;

  select c.notify_enabled
    into v_enabled
  from public.chat_room_notify_preferences c
  where c.app_user_id = trim(p_app_user_id)
    and c.room_id = trim(p_room_id)
  limit 1;

  return coalesce(v_enabled, true);
end;
$$;

create or replace function public.set_chat_room_notify_enabled(
  p_app_user_id text,
  p_room_id text,
  p_notify_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;
  if p_room_id is null or trim(p_room_id) = '' then
    raise exception 'room_id required';
  end if;

  insert into public.chat_room_notify_preferences (
    app_user_id, room_id, notify_enabled, created_at, updated_at
  ) values (
    trim(p_app_user_id), trim(p_room_id), coalesce(p_notify_enabled, true), now(), now()
  )
  on conflict (app_user_id, room_id)
  do update set
    notify_enabled = excluded.notify_enabled,
    updated_at = now();
end;
$$;

revoke all on function public.get_chat_room_notify_enabled(text, text) from public;
grant execute on function public.get_chat_room_notify_enabled(text, text) to anon, authenticated;

revoke all on function public.set_chat_room_notify_enabled(text, text, boolean) from public;
grant execute on function public.set_chat_room_notify_enabled(text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

