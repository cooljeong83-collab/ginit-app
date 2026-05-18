-- 모임 참여자(호스트·게스트)가 지닛 친구에게 FCM 초대 푸시를 보냅니다.
-- Vault: meeting_share_host_push_url, meeting_share_host_push_authorization (0083과 동일)

create extension if not exists pg_net;

create or replace function private.meeting_invite_friends_fcm(
  p_to_user_ids text[],
  p_meeting_route_id text,
  p_meeting_title text,
  p_inviter_nickname text,
  p_from_user_id text
)
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_url text;
  v_auth text;
  v_auth_trim text;
  v_auth_header text;
  v_apikey text;
  v_mt text := coalesce(nullif(trim(p_meeting_title), ''), '모임');
  v_who text := coalesce(nullif(trim(p_inviter_nickname), ''), '친구');
  v_mid text := coalesce(nullif(trim(p_meeting_route_id), ''), '');
  v_from text := public.ginit_normalize_app_user_id(coalesce(p_from_user_id, ''));
  v_recipients jsonb;
  v_payload jsonb;
begin
  select coalesce(jsonb_agg(distinct public.ginit_normalize_app_user_id(trim(x))), '[]'::jsonb)
  into v_recipients
  from unnest(coalesce(p_to_user_ids, array[]::text[])) as t(x)
  where nullif(trim(x), '') is not null
    and public.ginit_normalize_app_user_id(trim(x)) <> v_from
    and public.ginit_normalize_app_user_id(trim(x)) <> '';

  if v_mid = '' or jsonb_array_length(v_recipients) = 0 then
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_url'
  limit 1;

  select ds.decrypted_secret into v_auth
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_authorization'
  limit 1;

  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_auth), '') = '' then
    return;
  end if;

  v_auth_trim := btrim(v_auth);
  v_apikey := btrim(regexp_replace(v_auth_trim, '^Bearer[[:space:]]+', '', 'i'));
  if coalesce(v_apikey, '') = '' then
    v_apikey := v_auth_trim;
  end if;
  v_auth_header := 'Bearer ' || v_apikey;

  v_payload := jsonb_build_object(
    'toUserIds', v_recipients,
    'title', '모임 초대',
    'body', v_who || '님이 「' || v_mt || '」에 초대했어요. 눌러서 확인해 보세요.',
    'data', jsonb_build_object(
      'meetingId', v_mid,
      'action', 'meeting_friend_invite',
      'fromUserId', v_from,
      'url', 'ginitapp://meeting/' || v_mid
    )
  );

  perform net.http_post(
    url := trim(v_url),
    body := v_payload,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', v_auth_header,
      'apikey', v_apikey
    ),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function private.meeting_invite_friends_fcm(text[], text, text, text, text) from public;

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
