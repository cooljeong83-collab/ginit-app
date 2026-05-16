-- 모임 채팅: 참가자별 읽음 포인터(chat_read_pointers)를 한 번에 조회.
-- Supabase 메시지 경로에서는 Firestore meetings.chatReadMessageIdBy 가 갱신되지 않으므로,
-- 말풍선「안 읽은 사람」UI가 로컬 chat_rooms 읽음 맵을 채우려면 이 RPC가 필요합니다.

create or replace function public.chat_meeting_room_read_states_for_me(p_me text, p_meeting_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_rid text := nullif(trim(coalesce(p_meeting_id, '')), '');
  v_mid uuid;
  v_canonical text;
  v_rows jsonb;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('error', 'invalid_args');
  end if;

  v_mid := public._chat_resolve_meeting_uuid(v_rid);
  perform public._chat_assert_meeting_member(v_mid, v_me);
  v_canonical := v_mid::text;

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
        where m.room_kind = 'meeting'
          and m.room_id = v_canonical
          and m.deleted_at is null
          and m.seq <= cr.last_read_seq
        order by m.seq desc
        limit 1
      ) as read_message_id
    from public.chat_read_pointers cr
    where cr.room_kind = 'meeting'
      and cr.room_id = v_canonical
  ) x;

  return jsonb_build_object('readers', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.chat_meeting_room_read_states_for_me(text, text) from public;
grant execute on function public.chat_meeting_room_read_states_for_me(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
