-- 0167 purge 보강: room_id는 trim·meetings 조인으로 매칭(배열만 의존하지 않음).
-- 과거 ledger_meeting_delete(구버전)로 meetings만 삭제된 고아 채팅 행 일회 정리.

create or replace function private.meeting_room_ids(p_meeting_uuid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array(
      select distinct trim(x)
      from unnest(
        array[
          p_meeting_uuid::text,
          (
            select nullif(trim(coalesce(m.legacy_firestore_id, '')), '')
            from public.meetings m
            where m.id = p_meeting_uuid
          ),
          (
            select coalesce(
              nullif(trim(coalesce(m.legacy_firestore_id, '')), ''),
              m.id::text
            )
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

create or replace function private.meeting_chat_row_matches_meeting(
  p_meeting_uuid uuid,
  p_room_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.meetings m
    where m.id = p_meeting_uuid
      and (
        trim(coalesce(p_room_id, '')) = trim(m.id::text)
        or (
          nullif(trim(coalesce(m.legacy_firestore_id, '')), '') is not null
          and trim(coalesce(p_room_id, '')) = trim(m.legacy_firestore_id)
        )
      )
  );
$$;

revoke all on function private.meeting_chat_row_matches_meeting(uuid, text) from public;

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

  delete from public.chat_messages m
  where m.room_kind = 'meeting'
    and (
      (coalesce(array_length(v_room_ids, 1), 0) > 0 and trim(m.room_id) = any (v_room_ids))
      or private.meeting_chat_row_matches_meeting(p_meeting_uuid, m.room_id)
    );

  delete from public.chat_read_pointers p
  where p.room_kind = 'meeting'
    and (
      (coalesce(array_length(v_room_ids, 1), 0) > 0 and trim(p.room_id) = any (v_room_ids))
      or private.meeting_chat_row_matches_meeting(p_meeting_uuid, p.room_id)
    );

  delete from public.chat_room_seq s
  where s.room_kind = 'meeting'
    and (
      (coalesce(array_length(v_room_ids, 1), 0) > 0 and trim(s.room_id) = any (v_room_ids))
      or private.meeting_chat_row_matches_meeting(p_meeting_uuid, s.room_id)
    );

  delete from public.chat_room_participants crp
  where crp.room_kind = 'meeting'
    and (
      (coalesce(array_length(v_room_ids, 1), 0) > 0 and trim(crp.room_id) = any (v_room_ids))
      or private.meeting_chat_row_matches_meeting(p_meeting_uuid, crp.room_id)
    );
end;
$$;

-- meetings 행이 이미 없는 모임 채팅 고아 (0167 이전 삭제·수동 삭제 등)
create or replace function private.purge_orphan_meeting_chat_rows()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_messages m
  where m.room_kind = 'meeting'
    and not exists (
      select 1
      from public.meetings mt
      where trim(mt.id::text) = trim(m.room_id)
         or (
           nullif(trim(coalesce(mt.legacy_firestore_id, '')), '') is not null
           and trim(mt.legacy_firestore_id) = trim(m.room_id)
         )
    );

  delete from public.chat_read_pointers p
  where p.room_kind = 'meeting'
    and not exists (
      select 1
      from public.meetings mt
      where trim(mt.id::text) = trim(p.room_id)
         or (
           nullif(trim(coalesce(mt.legacy_firestore_id, '')), '') is not null
           and trim(mt.legacy_firestore_id) = trim(p.room_id)
         )
    );

  delete from public.chat_room_seq s
  where s.room_kind = 'meeting'
    and not exists (
      select 1
      from public.meetings mt
      where trim(mt.id::text) = trim(s.room_id)
         or (
           nullif(trim(coalesce(mt.legacy_firestore_id, '')), '') is not null
           and trim(mt.legacy_firestore_id) = trim(s.room_id)
         )
    );

  delete from public.chat_room_participants crp
  where crp.room_kind = 'meeting'
    and not exists (
      select 1
      from public.meetings mt
      where trim(mt.id::text) = trim(crp.room_id)
         or (
           nullif(trim(coalesce(mt.legacy_firestore_id, '')), '') is not null
           and trim(mt.legacy_firestore_id) = trim(crp.room_id)
         )
    );
end;
$$;

revoke all on function private.purge_orphan_meeting_chat_rows() from public;

do $$
begin
  perform private.purge_orphan_meeting_chat_rows();
end;
$$;

notify pgrst, 'reload schema';
