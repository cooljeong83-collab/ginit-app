-- Delta-sync chat messages (Supabase single source). Firestore replacement path.
-- - Per-room monotonic seq (chat_room_seq)
-- - Idempotent send via (room_kind, room_id, client_mutation_id)
-- - meeting room_id stored as canonical public.meetings.id::text (legacy id resolved via legacy_firestore_id)
-- - Access: security definer RPCs + RLS SELECT for Realtime (authenticated + participant match)

-- ─── Internal: resolve ledger meeting UUID from id or legacy_firestore_id ─────────
create or replace function public._chat_resolve_meeting_uuid(p_room_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.id from public.meetings m where m.id::text = nullif(trim(p_room_id), '')),
    (select m.id from public.meetings m where m.legacy_firestore_id = nullif(trim(p_room_id), ''))
  );
$$;

revoke all on function public._chat_resolve_meeting_uuid(text) from public;

-- ─── Seq counter per logical room ────────────────────────────────────────────────
create table if not exists public.chat_room_seq (
  room_kind text not null check (room_kind in ('meeting', 'social_dm')),
  room_id text not null,
  last_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_kind, room_id)
);

create index if not exists chat_room_seq_kind_idx on public.chat_room_seq (room_kind);

alter table public.chat_room_seq enable row level security;

drop policy if exists chat_room_seq_block_all on public.chat_room_seq;
create policy chat_room_seq_block_all on public.chat_room_seq
for all to anon, authenticated using (false) with check (false);

-- ─── Messages ────────────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_kind text not null check (room_kind in ('meeting', 'social_dm')),
  room_id text not null,
  seq bigint not null,
  sender_app_user_id text not null,
  kind text not null default 'text' check (kind in ('text', 'image', 'system')),
  body_text text,
  image_url text,
  image_album_batch_id text,
  reply_to jsonb,
  link_preview jsonb,
  client_mutation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  unique (room_kind, room_id, seq)
);

create unique index if not exists chat_messages_idem_ux
  on public.chat_messages (room_kind, room_id, client_mutation_id)
  where client_mutation_id is not null and length(trim(client_mutation_id)) > 0;

create index if not exists chat_messages_room_seq_idx
  on public.chat_messages (room_kind, room_id, seq asc);

alter table public.chat_messages enable row level security;

-- Read: meeting — participant via profiles.auth_user_id (Supabase Auth) OR app_user match is complex; use participant on meetings via meeting_participants + profiles
drop policy if exists chat_messages_select_meeting on public.chat_messages;
create policy chat_messages_select_meeting on public.chat_messages
for select to authenticated
using (
  room_kind = 'meeting'
  and exists (
    select 1
    from public.meeting_participants mp
    join public.profiles p on p.id = mp.profile_id
    where mp.meeting_id = room_id::uuid
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists chat_messages_select_social on public.chat_messages;
create policy chat_messages_select_social on public.chat_messages
for select to authenticated
using (
  room_kind = 'social_dm'
  and exists (
    select 1
    from public.chat_rooms cr
    where cr.id = room_id
      and cr.is_group = false
      and cr.participant_ids @> array[
        (select nullif(trim(p.app_user_id), '') from public.profiles p where p.auth_user_id = auth.uid() limit 1)
      ]::text[]
  )
);

drop policy if exists chat_messages_block_ins on public.chat_messages;
create policy chat_messages_block_ins on public.chat_messages
for insert to anon, authenticated with check (false);

drop policy if exists chat_messages_block_upd on public.chat_messages;
create policy chat_messages_block_upd on public.chat_messages
for update to anon, authenticated using (false) with check (false);

drop policy if exists chat_messages_block_del on public.chat_messages;
create policy chat_messages_block_del on public.chat_messages
for delete to anon, authenticated using (false);

-- ─── Read pointers (optional UI; RPC primary writer) ────────────────────────────
create table if not exists public.chat_read_pointers (
  room_kind text not null check (room_kind in ('meeting', 'social_dm')),
  room_id text not null,
  reader_app_user_id text not null,
  last_read_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_kind, room_id, reader_app_user_id)
);

create index if not exists chat_read_pointers_room_idx on public.chat_read_pointers (room_kind, room_id);

alter table public.chat_read_pointers enable row level security;

drop policy if exists chat_read_pointers_block on public.chat_read_pointers;
create policy chat_read_pointers_block on public.chat_read_pointers
for all to anon, authenticated using (false) with check (false);

-- ─── RPC: assert meeting member by app_user_id (caller-supplied, same pattern as chat_rooms_list_page) ─
create or replace function public._chat_assert_meeting_member(p_meeting_uuid uuid, p_me text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_meeting_uuid is null then
    raise exception 'meeting_not_found';
  end if;
  select exists (
    select 1
    from public.meeting_participants mp
    join public.profiles pr on pr.id = mp.profile_id
    where mp.meeting_id = p_meeting_uuid
      and lower(trim(pr.app_user_id)) = lower(trim(coalesce(p_me, '')))
  ) into v_ok;
  if not coalesce(v_ok, false) then
    raise exception 'not_meeting_participant';
  end if;
end;
$$;

revoke all on function public._chat_assert_meeting_member(uuid, text) from public;

create or replace function public._chat_assert_social_member(p_room_id text, p_me text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from public.chat_rooms cr
    where cr.id = p_room_id
      and cr.is_group = false
      and cr.participant_ids @> array[nullif(trim(coalesce(p_me, '')), '')]::text[]
  ) into v_ok;
  if not coalesce(v_ok, false) then
    raise exception 'not_chat_participant';
  end if;
end;
$$;

revoke all on function public._chat_assert_social_member(text, text) from public;

-- ─── chat_pull_deltas ────────────────────────────────────────────────────────────
create or replace function public.chat_pull_deltas(
  p_me text,
  p_room_kind text,
  p_room_id text,
  p_after_seq bigint,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_mid uuid;
  v_canonical text;
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_after bigint := greatest(coalesce(p_after_seq, 0), 0);
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'max_seq', v_after, 'has_more', false, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('rows', '[]'::jsonb, 'max_seq', v_after, 'has_more', false, 'error', 'invalid_room_kind');
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    perform public._chat_assert_meeting_member(v_mid, v_me);
    v_canonical := v_mid::text;
  else
    perform public._chat_assert_social_member(v_rid, v_me);
    v_canonical := v_rid;
  end if;

  return (
    with page as (
      select m.id, m.room_kind, m.room_id, m.seq, m.sender_app_user_id, m.kind, m.body_text, m.image_url,
             m.image_album_batch_id, m.reply_to, m.link_preview, m.client_mutation_id, m.created_at, m.updated_at, m.deleted_at
      from public.chat_messages m
      where m.room_kind = v_kind
        and m.room_id = v_canonical
        and m.seq > v_after
      order by m.seq asc
      limit v_lim + 1
    ),
    numbered as (
      select *, row_number() over (order by seq asc) as rn from page
    ),
    capped as (
      select * from numbered where rn <= v_lim
    ),
    mx as (
      select coalesce(max(seq), v_after) as max_seq from capped
    )
    select jsonb_build_object(
      'rows',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', c.id,
              'room_kind', c.room_kind,
              'room_id', c.room_id,
              'seq', c.seq,
              'sender_app_user_id', c.sender_app_user_id,
              'kind', c.kind,
              'body_text', c.body_text,
              'image_url', c.image_url,
              'image_album_batch_id', c.image_album_batch_id,
              'reply_to', c.reply_to,
              'link_preview', c.link_preview,
              'client_mutation_id', c.client_mutation_id,
              'created_at', c.created_at,
              'updated_at', c.updated_at,
              'deleted_at', c.deleted_at
            ) order by c.seq
          )
          from capped c
        ),
        '[]'::jsonb
      ),
      'max_seq', (select max_seq from mx),
      'has_more', (select count(*) > v_lim from numbered),
      'canonical_room_id', v_canonical
    )
  );
end;
$$;

revoke all on function public.chat_pull_deltas(text, text, text, bigint, int) from public;
grant execute on function public.chat_pull_deltas(text, text, text, bigint, int) to anon, authenticated;

-- ─── chat_send_message ─────────────────────────────────────────────────────────────
create or replace function public.chat_send_message(
  p_me text,
  p_room_kind text,
  p_room_id text,
  p_client_mutation_id text,
  p_kind text,
  p_body_text text default null,
  p_image_url text default null,
  p_image_album_batch_id text default null,
  p_reply_to jsonb default null,
  p_link_preview jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_mid uuid;
  v_canonical text;
  v_kind_msg text := case lower(trim(coalesce(p_kind, 'text')))
    when 'image' then 'image'
    when 'system' then 'system'
    else 'text' end;
  v_mut text := nullif(trim(coalesce(p_client_mutation_id, '')), '');
  v_existing record;
  v_seq bigint;
  v_new_id uuid;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('ok', false, 'error', 'invalid_room_kind');
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    perform public._chat_assert_meeting_member(v_mid, v_me);
    v_canonical := v_mid::text;
  else
    perform public._chat_assert_social_member(v_rid, v_me);
    v_canonical := v_rid;
  end if;

  if v_mut is not null then
    select m.id, m.seq into v_existing
    from public.chat_messages m
    where m.room_kind = v_kind and m.room_id = v_canonical and m.client_mutation_id = v_mut
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_existing.id, 'seq', v_existing.seq);
    end if;
  end if;

  insert into public.chat_room_seq as s (room_kind, room_id, last_seq)
  values (v_kind, v_canonical, 0)
  on conflict (room_kind, room_id) do nothing;

  update public.chat_room_seq s
  set last_seq = s.last_seq + 1, updated_at = now()
  where s.room_kind = v_kind and s.room_id = v_canonical
  returning s.last_seq into v_seq;

  insert into public.chat_messages (
    room_kind, room_id, seq, sender_app_user_id, kind, body_text, image_url, image_album_batch_id,
    reply_to, link_preview, client_mutation_id
  )
  values (
    v_kind, v_canonical, v_seq, v_me, v_kind_msg, p_body_text, p_image_url, p_image_album_batch_id,
    p_reply_to, p_link_preview, v_mut
  )
  returning id into v_new_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'id', v_new_id, 'seq', v_seq);
exception
  when unique_violation then
    if v_mut is not null then
      select m.id, m.seq into v_existing
      from public.chat_messages m
      where m.room_kind = v_kind and m.room_id = v_canonical and m.client_mutation_id = v_mut
      limit 1;
      if found then
        return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_existing.id, 'seq', v_existing.seq);
      end if;
    end if;
    return jsonb_build_object('ok', false, 'error', 'unique_violation');
end;
$$;

revoke all on function public.chat_send_message(text, text, text, text, text, text, text, text, jsonb, jsonb) from public;
grant execute on function public.chat_send_message(text, text, text, text, text, text, text, text, jsonb, jsonb) to anon, authenticated;

-- ─── chat_mark_read ───────────────────────────────────────────────────────────────
create or replace function public.chat_mark_read(
  p_me text,
  p_room_kind text,
  p_room_id text,
  p_last_read_seq bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_mid uuid;
  v_canonical text;
  v_seq bigint := greatest(coalesce(p_last_read_seq, 0), 0);
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('ok', false, 'error', 'invalid_room_kind');
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    perform public._chat_assert_meeting_member(v_mid, v_me);
    v_canonical := v_mid::text;
  else
    perform public._chat_assert_social_member(v_rid, v_me);
    v_canonical := v_rid;
  end if;

  insert into public.chat_read_pointers (room_kind, room_id, reader_app_user_id, last_read_seq, updated_at)
  values (v_kind, v_canonical, v_me, v_seq, now())
  on conflict (room_kind, room_id, reader_app_user_id)
  do update set
    last_read_seq = greatest(public.chat_read_pointers.last_read_seq, excluded.last_read_seq),
    updated_at = now();

  return jsonb_build_object('ok', true, 'last_read_seq', v_seq);
end;
$$;

revoke all on function public.chat_mark_read(text, text, text, bigint) from public;
grant execute on function public.chat_mark_read(text, text, text, bigint) to anon, authenticated;

-- ─── Realtime publication ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $$;

notify pgrst, 'reload schema';
