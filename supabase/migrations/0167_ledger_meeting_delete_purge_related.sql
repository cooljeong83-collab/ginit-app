-- 모임 삭제 시 채팅·정산·초대 알림 등 FK 없는 연관 행을 함께 정리합니다.
-- 앱은 `ledger_meeting_delete` 한 RPC로 DB purge + meetings 행 삭제(CASCADE)를 수행합니다.

create schema if not exists private;

-- 모임 UUID 기준 canonical·legacy room_id 목록
create or replace function private.meeting_room_ids(p_meeting_uuid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array(
      select distinct x
      from unnest(
        array[
          p_meeting_uuid::text,
          (
            select nullif(trim(coalesce(m.legacy_firestore_id, '')), '')
            from public.meetings m
            where m.id = p_meeting_uuid
          )
        ]
      ) as t(x)
      where x is not null and trim(x) <> ''
    ),
    array[]::text[]
  );
$$;

revoke all on function private.meeting_room_ids(uuid) from public;

create or replace function private.purge_meeting_chat_rows(p_meeting_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_ids text[];
begin
  if p_meeting_uuid is null then
    return;
  end if;

  v_room_ids := private.meeting_room_ids(p_meeting_uuid);
  if coalesce(array_length(v_room_ids, 1), 0) = 0 then
    return;
  end if;

  delete from public.chat_messages
  where room_kind = 'meeting' and room_id = any (v_room_ids);

  delete from public.chat_read_pointers
  where room_kind = 'meeting' and room_id = any (v_room_ids);

  delete from public.chat_room_seq
  where room_kind = 'meeting' and room_id = any (v_room_ids);

  delete from public.chat_room_participants
  where room_kind = 'meeting' and room_id = any (v_room_ids);
end;
$$;

revoke all on function private.purge_meeting_chat_rows(uuid) from public;

create or replace function private.purge_meeting_related_rows(p_meeting_uuid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_ids text[];
begin
  if p_meeting_uuid is null then
    return;
  end if;

  perform private.purge_meeting_chat_rows(p_meeting_uuid);

  v_room_ids := private.meeting_room_ids(p_meeting_uuid);
  if coalesce(array_length(v_room_ids, 1), 0) = 0 then
    return;
  end if;

  delete from public.settlement_receipt_analyses
  where meeting_id = any (v_room_ids);

  delete from public.notifications
  where type = 'meeting_friend_invite'
    and nullif(trim(coalesce(payload->>'meetingId', '')), '') = any (v_room_ids);
end;
$$;

revoke all on function private.purge_meeting_related_rows(uuid) from public;

create or replace function public.ledger_meeting_delete(p_meeting_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
begin
  v_mid := public._chat_resolve_meeting_uuid(nullif(trim(coalesce(p_meeting_id, '')), ''));
  if v_mid is null then
    return;
  end if;

  perform private.purge_meeting_related_rows(v_mid);
  delete from public.meetings where id = v_mid;
end;
$$;

revoke all on function public.ledger_meeting_delete(text) from public;
grant execute on function public.ledger_meeting_delete(text) to anon, authenticated;

-- 수동 채팅 전체 삭제: legacy room_id + chat_room_participants 포함
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
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;

  v_mid := public._chat_resolve_meeting_uuid(v_rid);
  perform public._chat_assert_meeting_member(v_mid, v_me);
  perform private.purge_meeting_chat_rows(v_mid);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.chat_delete_all_meeting_messages(text, text) from public;
grant execute on function public.chat_delete_all_meeting_messages(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
