-- 친구 DM: 참가자별 읽음 포인터(chat_read_pointers)를 한 번에 조회.
-- `chat_social_room_snapshot_for_me`는 내 포인터만 스냅샷에 담으므로, 말풍선「상대 읽음」UI는 이 RPC로 로컬 맵을 채웁니다.

create or replace function public.chat_social_room_read_states_for_me(p_me text, p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_rows jsonb;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('error', 'invalid_args');
  end if;

  perform public._chat_assert_social_member(v_rid, v_me);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'reader_app_user_id', x.reader_app_user_id,
        'last_read_seq', x.last_read_seq,
        'read_message_id', x.read_message_id,
        'updated_at', x.updated_at
      )
    ),
    '[]'::jsonb
  ) into v_rows
  from (
    select
      cr.reader_app_user_id,
      cr.last_read_seq,
      cr.updated_at,
      (
        select m.id::text
        from public.chat_messages m
        where m.room_kind = 'social_dm'
          and m.room_id = v_rid
          and m.deleted_at is null
          and m.seq <= cr.last_read_seq
        order by m.seq desc
        limit 1
      ) as read_message_id
    from public.chat_read_pointers cr
    where cr.room_kind = 'social_dm'
      and cr.room_id = v_rid
  ) x;

  return jsonb_build_object('readers', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.chat_social_room_read_states_for_me(text, text) from public;
grant execute on function public.chat_social_room_read_states_for_me(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
