-- `trg_chat_messages_bump_unread` increments `chat_room_participants.unread_count` on INSERT.
-- `chat_mark_read` / `chat_mark_read_caught_up` only touched `chat_read_pointers`, so server
-- unread_count never dropped on read → list / Realtime drift vs local clears.
-- Wire read RPCs to the existing `chat_reset_room_unread` (same membership checks already done).

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

  perform public.chat_reset_room_unread(v_me, v_kind, v_canonical);

  return jsonb_build_object('ok', true, 'last_read_seq', v_seq);
end;
$$;

create or replace function public.chat_mark_read_caught_up(
  p_me text,
  p_room_kind text,
  p_room_id text
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
  v_max bigint := 0;
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

  select coalesce(max(m.seq), 0) into v_max
  from public.chat_messages m
  where m.room_kind = v_kind and m.room_id = v_canonical and m.deleted_at is null;

  insert into public.chat_read_pointers (room_kind, room_id, reader_app_user_id, last_read_seq, updated_at)
  values (v_kind, v_canonical, v_me, v_max, now())
  on conflict (room_kind, room_id, reader_app_user_id)
  do update set
    last_read_seq = greatest(public.chat_read_pointers.last_read_seq, excluded.last_read_seq),
    updated_at = now();

  perform public.chat_reset_room_unread(v_me, v_kind, v_canonical);

  return jsonb_build_object('ok', true, 'last_read_seq', v_max);
end;
$$;

notify pgrst, 'reload schema';
