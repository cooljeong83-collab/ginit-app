-- 이미 unread_count=0인 행에 대해 UPDATE를 하지 않음 → updated_at 불필요 갱신·Realtime UPDATE 폭주 방지.
-- chat_mark_read 등이 반복 호출돼도 동일 상태면 복제 이벤트가 나가지 않음.

create or replace function public.chat_reset_room_unread(
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
  v_n int;
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

  update public.chat_room_participants crp
  set unread_count = 0, updated_at = now()
  where crp.room_kind = v_kind
    and crp.room_id = v_canonical
    and lower(trim(crp.app_user_id)) = lower(trim(v_me))
    and crp.unread_count > 0;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'rows_updated', v_n);
end;
$$;

notify pgrst, 'reload schema';
