-- 방별 참가자 미읽음 카운트 (chat_room_participants.unread_count).
-- - 메시지 INSERT 시: 이 레포의 메시지 테이블은 public.chat_messages 입니다.
--   (별도 public.messages 가 있고 스키마가 동일하면 동일 트리거 함수를 그 테이블에도 연결하면 됩니다.)
-- - meeting: meeting_participants + profiles.app_user_id 기준으로 발신자 제외 전원 +1
-- - social_dm: chat_rooms.participant_ids 기준으로 발신자 제외 전원 +1
-- - 읽음 처리: security definer RPC chat_reset_room_unread

create table if not exists public.chat_room_participants (
  room_kind text not null check (room_kind in ('meeting', 'social_dm')),
  room_id text not null,
  app_user_id text not null,
  unread_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_kind, room_id, app_user_id)
);

alter table public.chat_room_participants
  add column if not exists unread_count bigint;

update public.chat_room_participants
set unread_count = 0
where unread_count is null;

alter table public.chat_room_participants
  alter column unread_count set default 0;

alter table public.chat_room_participants
  alter column unread_count set not null;

create index if not exists chat_room_participants_app_user_room_idx
  on public.chat_room_participants (app_user_id, room_kind, room_id);

alter table public.chat_room_participants enable row level security;

drop policy if exists chat_room_participants_block on public.chat_room_participants;
create policy chat_room_participants_block on public.chat_room_participants
for all to anon, authenticated using (false) with check (false);

-- ─── INSERT chat_messages → 다른 참가자 unread_count +1 ───────────────────────
create or replace function public._chat_bump_unread_on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    return coalesce(new, old);
  end if;

  if new.deleted_at is not null then
    return new;
  end if;

  if new.room_kind = 'meeting' then
    insert into public.chat_room_participants (room_kind, room_id, app_user_id, unread_count, updated_at)
    select
      'meeting',
      new.room_id,
      nullif(trim(pr.app_user_id), ''),
      1,
      now()
    from public.meeting_participants mp
    join public.profiles pr on pr.id = mp.profile_id
    where mp.meeting_id = new.room_id::uuid
      and nullif(trim(pr.app_user_id), '') is not null
      and lower(nullif(trim(pr.app_user_id), '')) <> lower(nullif(trim(new.sender_app_user_id), ''))
    on conflict (room_kind, room_id, app_user_id) do update set
      unread_count = public.chat_room_participants.unread_count + excluded.unread_count,
      updated_at = now();

  elsif new.room_kind = 'social_dm' then
    insert into public.chat_room_participants (room_kind, room_id, app_user_id, unread_count, updated_at)
    select
      'social_dm',
      new.room_id,
      nullif(trim(p.uid), ''),
      1,
      now()
    from public.chat_rooms cr
    cross join lateral unnest(cr.participant_ids) as p(uid)
    where cr.id = new.room_id
      and nullif(trim(p.uid), '') is not null
      and lower(nullif(trim(p.uid), '')) <> lower(nullif(trim(new.sender_app_user_id), ''))
    on conflict (room_kind, room_id, app_user_id) do update set
      unread_count = public.chat_room_participants.unread_count + excluded.unread_count,
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public._chat_bump_unread_on_message_insert() from public;

drop trigger if exists trg_chat_messages_bump_unread on public.chat_messages;
create trigger trg_chat_messages_bump_unread
after insert on public.chat_messages
for each row
execute function public._chat_bump_unread_on_message_insert();

-- ─── RPC: 내 unread_count 를 0으로 (방 입장·읽음 처리) ─────────────────────────
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
    and lower(trim(crp.app_user_id)) = lower(trim(v_me));

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'rows_updated', v_n);
end;
$$;

revoke all on function public.chat_reset_room_unread(text, text, text) from public;
grant execute on function public.chat_reset_room_unread(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
