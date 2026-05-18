-- 모임 친구 초대: 수신자 `public.notifications` 행 + 읽음 처리(새소식 연동)
-- (0145 미적용 원격 DB 대비: notifications 테이블·RLS·realtime을 idempotent 보장)

create schema if not exists private;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null default 'unknown',
  payload jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.app_user_id = notifications.user_id
      and p.auth_user_id = auth.uid()
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

create or replace function private.insert_notification_for_app_user(
  p_user_id text,
  p_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.ginit_normalize_app_user_id(coalesce(p_user_id, ''));
  v_type text := nullif(trim(coalesce(p_type, '')), '');
  v_id uuid;
begin
  if v_uid = '' or v_type is null then
    return null;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (v_uid, v_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.insert_notification_for_app_user(text, text, jsonb) from public;

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
for update
using (
  exists (
    select 1
    from public.profiles p
    where p.app_user_id = notifications.user_id
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.app_user_id = notifications.user_id
      and p.auth_user_id = auth.uid()
  )
);

create index if not exists notifications_user_type_unread_idx
  on public.notifications (user_id, type, created_at desc)
  where read_at is null;

-- meeting_invite_friends: FCM 전에 notifications INSERT
create or replace function public.meeting_invite_friends(
  p_meeting_id text,
  p_inviter_app_user_id text,
  p_invitee_app_user_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter text := public.ginit_normalize_app_user_id(coalesce(p_inviter_app_user_id, ''));
  v_mid text := trim(coalesce(p_meeting_id, ''));
  v_meeting public.meetings%rowtype;
  v_inviter_profile_id uuid;
  v_host_norm text;
  v_route_id text;
  v_title text;
  v_inviter_nick text;
  v_invitee_raw text;
  v_invitee_norm text;
  v_eligible text[] := array[]::text[];
  v_skipped_not_friend int := 0;
  v_skipped_already_joined int := 0;
  v_skipped_self int := 0;
  v_skipped_empty int := 0;
  v_is_participant boolean := false;
  v_payload jsonb;
begin
  if v_inviter = '' or v_mid = '' then
    return jsonb_build_object('ok', false, 'message', '모임 또는 사용자 정보가 없습니다.');
  end if;

  if coalesce(array_length(p_invitee_app_user_ids, 1), 0) > 20 then
    return jsonb_build_object('ok', false, 'message', '한 번에 최대 20명까지 초대할 수 있어요.');
  end if;

  select pr.id, coalesce(nullif(trim(pr.nickname), ''), nullif(trim(pr.display_name), ''), '친구')
  into v_inviter_profile_id, v_inviter_nick
  from public.profiles pr
  where public.ginit_normalize_app_user_id(pr.app_user_id) = v_inviter
  limit 1;

  if v_inviter_profile_id is null then
    return jsonb_build_object('ok', false, 'message', '프로필을 찾을 수 없어요.');
  end if;

  select m.*
  into v_meeting
  from public.meetings m
  where m.id::text = v_mid
     or coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text) = v_mid
  limit 1;

  if v_meeting.id is null then
    return jsonb_build_object('ok', false, 'message', '모임을 찾을 수 없어요.');
  end if;

  v_route_id := coalesce(nullif(trim(v_meeting.legacy_firestore_id), ''), v_meeting.id::text);
  v_title := coalesce(nullif(trim(v_meeting.title), ''), '모임');

  select public.ginit_normalize_app_user_id(coalesce(ph.app_user_id, ''))
  into v_host_norm
  from public.profiles ph
  where ph.id = v_meeting.created_by_profile_id
  limit 1;

  if v_host_norm = v_inviter then
    v_is_participant := true;
  else
    select exists (
      select 1
      from public.meeting_participants mp
      where mp.meeting_id = v_meeting.id
        and mp.profile_id = v_inviter_profile_id
    )
    into v_is_participant;
  end if;

  if not v_is_participant then
    return jsonb_build_object('ok', false, 'message', '참여 중인 모임만 친구를 초대할 수 있어요.');
  end if;

  foreach v_invitee_raw in array coalesce(p_invitee_app_user_ids, array[]::text[]) loop
    v_invitee_norm := public.ginit_normalize_app_user_id(trim(coalesce(v_invitee_raw, '')));
    if v_invitee_norm = '' then
      v_skipped_empty := v_skipped_empty + 1;
      continue;
    end if;
    if v_invitee_norm = v_inviter then
      v_skipped_self := v_skipped_self + 1;
      continue;
    end if;

    if exists (
      select 1
      from public.meeting_participants mp
      inner join public.profiles pr on pr.id = mp.profile_id
      where mp.meeting_id = v_meeting.id
        and public.ginit_normalize_app_user_id(pr.app_user_id) = v_invitee_norm
    ) or (v_host_norm <> '' and v_host_norm = v_invitee_norm) then
      v_skipped_already_joined := v_skipped_already_joined + 1;
      continue;
    end if;

    if not exists (
      select 1
      from public.friends f
      where f.status = 'accepted'
        and (
          (public.ginit_normalize_app_user_id(f.requester_app_user_id) = v_inviter
            and public.ginit_normalize_app_user_id(f.addressee_app_user_id) = v_invitee_norm)
          or
          (public.ginit_normalize_app_user_id(f.addressee_app_user_id) = v_inviter
            and public.ginit_normalize_app_user_id(f.requester_app_user_id) = v_invitee_norm)
        )
    ) then
      v_skipped_not_friend := v_skipped_not_friend + 1;
      continue;
    end if;

    if not (v_invitee_norm = any (v_eligible)) then
      v_eligible := array_append(v_eligible, v_invitee_norm);
    end if;
  end loop;

  if coalesce(array_length(v_eligible, 1), 0) = 0 then
    return jsonb_build_object(
      'ok', true,
      'sent', 0,
      'reason', 'no_eligible_invitees',
      'skipped', jsonb_build_object(
        'not_friend', v_skipped_not_friend,
        'already_joined', v_skipped_already_joined,
        'self', v_skipped_self,
        'empty', v_skipped_empty
      )
    );
  end if;

  v_payload := jsonb_build_object(
    'meetingId', v_route_id,
    'meetingTitle', v_title,
    'inviterAppUserId', v_inviter,
    'inviterNickname', v_inviter_nick,
    'url', 'ginitapp://meeting/' || v_route_id
  );

  foreach v_invitee_norm in array v_eligible loop
    perform private.insert_notification_for_app_user(
      v_invitee_norm,
      'meeting_friend_invite',
      v_payload
    );
  end loop;

  perform private.meeting_invite_friends_fcm(
    v_eligible,
    v_route_id,
    v_title,
    v_inviter_nick,
    v_inviter
  );

  return jsonb_build_object(
    'ok', true,
    'sent', coalesce(array_length(v_eligible, 1), 0),
    'skipped', jsonb_build_object(
      'not_friend', v_skipped_not_friend,
      'already_joined', v_skipped_already_joined,
      'self', v_skipped_self,
      'empty', v_skipped_empty
    )
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'message', coalesce(sqlerrm, '초대 처리에 실패했어요.')
    );
end;
$$;

revoke all on function public.meeting_invite_friends(text, text, text[]) from public;
grant execute on function public.meeting_invite_friends(text, text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';
