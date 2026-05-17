-- `social_*` 등 잘못된 meeting_id로 호출 시 EXCEPTION 대신 jsonb 반환(로그 ERROR 방지).

create or replace function public.chat_meeting_summary_for_me(p_me text, p_meeting_id text)
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
  v_lr bigint := 0;
  v_unread int := 0;
  v_lm_id text;
  v_lm_preview text;
  v_lm_sender text;
  v_lm_at timestamptz;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('error', 'invalid_args');
  end if;

  v_mid := public._chat_resolve_meeting_uuid(v_rid);
  if v_mid is null then
    return jsonb_build_object('error', 'meeting_not_found');
  end if;
  perform public._chat_assert_meeting_member(v_mid, v_me);
  v_canonical := v_mid::text;

  select coalesce(cr.last_read_seq, 0) into v_lr
  from public.chat_read_pointers cr
  where cr.room_kind = 'meeting' and cr.room_id = v_canonical and lower(trim(cr.reader_app_user_id)) = lower(v_me)
  limit 1;

  select count(*)::int into v_unread
  from public.chat_messages m
  where m.room_kind = 'meeting' and m.room_id = v_canonical and m.deleted_at is null and m.seq > v_lr;

  select
    m.id::text,
    case
      when m.kind = 'image' then coalesce(nullif(trim(m.body_text), ''), '사진')
      when m.kind = 'system' then coalesce(nullif(trim(m.body_text), ''), '')
      else coalesce(nullif(trim(m.body_text), ''), '')
    end,
    m.sender_app_user_id,
    m.created_at
  into v_lm_id, v_lm_preview, v_lm_sender, v_lm_at
  from public.chat_messages m
  where m.room_kind = 'meeting' and m.room_id = v_canonical and m.deleted_at is null
  order by m.seq desc
  limit 1;

  return jsonb_build_object(
    'unread_count', v_unread,
    'last_message_id', v_lm_id,
    'last_message_preview', left(coalesce(v_lm_preview, ''), 500),
    'last_sender_id', v_lm_sender,
    'last_message_at', v_lm_at,
    'updated_at', now(),
    'canonical_room_id', v_canonical
  );
end;
$$;

notify pgrst, 'reload schema';
