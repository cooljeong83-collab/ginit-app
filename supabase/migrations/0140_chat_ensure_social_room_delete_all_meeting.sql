-- 소셜 DM: `chat_rooms` 행 보장(RLS로 직접 INSERT 불가 → security definer RPC).
-- 모임 채팅: 방 단위 메시지·읽음 포인터·seq 카운터 일괄 삭제(Firestore `deleteAllMeetingChatMessages` 대응).

-- ─── 소셜 DM 방 보장 ─────────────────────────────────────────────────────────────
create or replace function public.chat_ensure_social_dm_room(
  p_me text,
  p_room_id text,
  p_peer_a text,
  p_peer_b text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_a text := nullif(trim(coalesce(p_peer_a, '')), '');
  v_b text := nullif(trim(coalesce(p_peer_b, '')), '');
  v_lo text;
  v_hi text;
  v_expected text;
begin
  if v_me is null or v_rid is null or v_a is null or v_b is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;
  if v_a = v_b then
    return jsonb_build_object('ok', false, 'error', 'invalid_peers');
  end if;
  if v_a < v_b then
    v_lo := v_a;
    v_hi := v_b;
  else
    v_lo := v_b;
    v_hi := v_a;
  end if;
  v_expected := 'social_' || v_lo || '__' || v_hi;
  if lower(v_rid) <> lower(v_expected) then
    return jsonb_build_object('ok', false, 'error', 'room_id_mismatch');
  end if;
  if lower(v_me) not in (lower(v_lo), lower(v_hi)) then
    return jsonb_build_object('ok', false, 'error', 'not_participant');
  end if;

  insert into public.chat_rooms (id, participant_ids, is_group, updated_at)
  values (v_expected, array[v_lo, v_hi]::text[], false, now())
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.chat_ensure_social_dm_room(text, text, text, text) from public;
grant execute on function public.chat_ensure_social_dm_room(text, text, text, text) to anon, authenticated;

-- ─── 모임 채팅 전체 삭제(하드 삭제) ───────────────────────────────────────────────
create or replace function public.chat_delete_all_meeting_messages(
  p_me text,
  p_meeting_id text
)
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
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;

  v_mid := public._chat_resolve_meeting_uuid(v_rid);
  perform public._chat_assert_meeting_member(v_mid, v_me);
  v_canonical := v_mid::text;

  delete from public.chat_messages
  where room_kind = 'meeting' and room_id = v_canonical;

  delete from public.chat_read_pointers
  where room_kind = 'meeting' and room_id = v_canonical;

  delete from public.chat_room_seq
  where room_kind = 'meeting' and room_id = v_canonical;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.chat_delete_all_meeting_messages(text, text) from public;
grant execute on function public.chat_delete_all_meeting_messages(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
