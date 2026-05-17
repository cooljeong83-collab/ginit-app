-- 잘못된 room_id(친구 DM `social_*` 등)로 `chat_mark_read_caught_up` 호출 시 EXCEPTION 대신 jsonb 반환.
-- PostgREST 로그의 ERROR `meeting_not_found` 폭주 방지(클라이언트 가드와 병행).

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
    if v_mid is null then
      return jsonb_build_object('ok', false, 'error', 'meeting_not_found');
    end if;
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
