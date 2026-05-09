-- 웹 공유 게스트가 참여(join) 또는 참가 신청(request)하면 모임 호스트에게 FCM 푸시(Edge `fcm-push-send`).
--
-- 운영 설정 (Supabase Dashboard → Project Settings → Vault, 또는 SQL로 secret 생성):
--   이름: meeting_share_host_push_url
--   값:  https://<project-ref>.supabase.co/functions/v1/fcm-push-send
--   이름: meeting_share_host_push_authorization
--   값:  Bearer <SUPABASE_ANON_KEY 또는 SERVICE_ROLE_KEY>  (fcm-push-send 는 verify_jwt=false 이지만 게이트웨이용 Bearer 필요)
--
-- Vault/URL이 없으면 알림만 생략하고 RPC는 정상 완료합니다.

create schema if not exists private;

create extension if not exists pg_net;

create or replace function private.meeting_share_notify_host_web_guest_fcm(
  p_host text,
  p_meeting_id uuid,
  p_meeting_title text,
  p_guest_label text,
  p_event text,
  p_guest_user_id text
)
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_host text := public.ginit_normalize_app_user_id(coalesce(p_host, ''));
  v_url text;
  v_auth text;
  v_title text;
  v_body text;
  v_action text;
  v_mt text := coalesce(nullif(trim(p_meeting_title), ''), '모임');
  v_who text := coalesce(nullif(trim(p_guest_label), ''), '게스트');
  v_payload jsonb;
begin
  if v_host = '' then
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'meeting_share_host_push skipped: vault.decrypted_secrets not found';
    return;
  end if;

  select ds.decrypted_secret
  into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_url'
  limit 1;

  select ds.decrypted_secret
  into v_auth
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_authorization'
  limit 1;

  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_auth), '') = '' then
    raise notice 'meeting_share_host_push skipped: set vault secrets meeting_share_host_push_url and meeting_share_host_push_authorization';
    return;
  end if;

  if p_event = 'join_requested' then
    v_title := '참가 신청이 왔어요';
    v_body := '「' || v_mt || '」에 ' || v_who || '님이 참가를 신청했습니다. 눌러서 확인해 주세요.';
    v_action := 'participant_join_requested';
  else
    v_title := '참여자가 들어왔어요';
    v_body := '「' || v_mt || '」에 ' || v_who || '님이 참여했습니다.';
    v_action := 'participant_joined';
  end if;

  v_payload := jsonb_build_object(
    'toUserIds', jsonb_build_array(v_host),
    'title', v_title,
    'body', v_body,
    'data', jsonb_build_object(
      'meetingId', p_meeting_id::text,
      'action', v_action,
      'participantId', p_guest_user_id,
      'url', 'ginitapp://meeting/' || p_meeting_id::text
    )
  );

  perform net.http_post(
    url := trim(v_url),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', trim(v_auth)
    ),
    body := v_payload
  );
end;
$$;

revoke all on function private.meeting_share_notify_host_web_guest_fcm(text, uuid, text, text, text, text) from public;

create or replace function public.meeting_share_guest_join(
  p_token text,
  p_guest_user_id text,
  p_display_name text,
  p_votes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
  v_mid uuid;
  v_ok boolean;
  v_fs jsonb;
  v_gn text;
  v_dn text := left(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g'), 40);
  v_host text;
  v_kicked text[];
  v_part jsonb;
  v_tally jsonb;
  v_dates_new text[];
  v_places_new text[];
  v_movies_new text[];
  v_cap int;
  v_row jsonb;
  v_new_log jsonb;
  v_in_list boolean := false;
  v_known boolean := false;
begin
  select t.o_link_id, t.o_meeting_id, t.o_ok
  into v_link_id, v_mid, v_ok
  from public.meeting_share_try_resolve_token(p_token) as t;
  if not coalesce(v_ok, false) then
    raise exception 'meeting_share_invalid_or_expired_token';
  end if;

  select coalesce(m.extra_data->'fs', '{}'::jsonb)
  into v_fs
  from public.meetings m
  where m.id = v_mid
  for update;

  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  if coalesce((v_fs->>'scheduleConfirmed')::boolean, false) then
    raise exception 'meeting_share_schedule_already_confirmed';
  end if;

  if public.meeting_share_requires_host_approval(v_fs) then
    raise exception 'meeting_share_use_request_endpoint';
  end if;

  v_host := public.ginit_normalize_app_user_id(coalesce(v_fs->>'createdBy', ''));

  if coalesce(nullif(trim(p_guest_user_id), ''), '') <> ''
     and public.meeting_share_is_ginitweb_guest_id(trim(p_guest_user_id)) then
    v_gn := trim(p_guest_user_id);
    v_part := coalesce(v_fs->'participantIds', '[]'::jsonb);
    select exists(select 1 from jsonb_array_elements_text(v_part) x where x = v_gn) into v_known;
    if not v_known then
      select exists(
        select 1 from jsonb_array_elements(coalesce(v_fs->'joinRequests', '[]'::jsonb)) jr
        where jr->>'userId' = v_gn
      ) into v_known;
    end if;
    if not v_known then
      v_gn := 'ginitweb_' || public.meeting_share_gen_uuid_v4()::text;
    end if;
  else
    v_gn := 'ginitweb_' || public.meeting_share_gen_uuid_v4()::text;
  end if;

  if v_gn = v_host then
    raise exception 'meeting_share_invalid_guest';
  end if;

  select coalesce(array_agg(k) filter (where k <> ''), array[]::text[])
  into v_kicked
  from jsonb_array_elements_text(coalesce(v_fs->'kickedParticipantIds', '[]'::jsonb)) as t(k);
  if v_gn = any(v_kicked) then
    raise exception 'meeting_share_guest_kicked';
  end if;

  v_dates_new := public.meeting_share_vote_string_ids(p_votes, 'dateChipIds');
  v_places_new := public.meeting_share_vote_string_ids(p_votes, 'placeChipIds');
  v_movies_new := public.meeting_share_vote_string_ids(p_votes, 'movieChipIds');

  v_part := coalesce(v_fs->'participantIds', '[]'::jsonb);
  select exists(select 1 from jsonb_array_elements_text(v_part) x where x = v_gn) into v_in_list;

  if v_in_list then
    update public.meeting_share_links set last_used_at = now() where id = v_link_id;
    return jsonb_build_object('guestUserId', v_gn, 'alreadyJoined', true);
  end if;

  v_cap := greatest(1, coalesce((v_fs->>'capacity')::int, 1));
  if v_cap < 999 and public.meeting_share_distinct_participant_count(v_fs) >= v_cap then
    raise exception 'meeting_share_capacity_full';
  end if;

  v_tally := coalesce(v_fs->'voteTallies', '{}'::jsonb);
  v_tally := jsonb_strip_nulls(
    jsonb_build_object(
      'dates', public.meeting_share_tally_apply_delta(v_tally, 'dates', array[]::text[], v_dates_new),
      'places', public.meeting_share_tally_apply_delta(v_tally, 'places', array[]::text[], v_places_new),
      'movies', public.meeting_share_tally_apply_delta(v_tally, 'movies', array[]::text[], v_movies_new)
    )
  );

  select coalesce(jsonb_agg(e), '[]'::jsonb)
  into v_new_log
  from jsonb_array_elements(coalesce(v_fs->'participantVoteLog', '[]'::jsonb)) e
  where e->>'userId' is distinct from v_gn;

  v_row := jsonb_build_object(
    'userId', v_gn,
    'dateChipIds', coalesce(to_jsonb(v_dates_new), '[]'::jsonb),
    'placeChipIds', coalesce(to_jsonb(v_places_new), '[]'::jsonb),
    'movieChipIds', coalesce(to_jsonb(v_movies_new), '[]'::jsonb)
  );
  if v_dn <> '' then
    v_row := v_row || jsonb_build_object('displayName', v_dn);
  end if;
  v_new_log := v_new_log || jsonb_build_array(v_row);

  v_fs := v_fs
    || jsonb_build_object(
      'participantIds', v_part || jsonb_build_array(to_jsonb(v_gn)),
      'voteTallies', v_tally,
      'participantVoteLog', v_new_log
    )
    || jsonb_build_object('id', v_mid::text);

  perform public.meeting_share_sync_meeting_from_fs(v_mid, v_fs);
  update public.meeting_share_links set last_used_at = now() where id = v_link_id;

  perform private.meeting_share_notify_host_web_guest_fcm(
    v_host,
    v_mid,
    coalesce(nullif(trim(v_fs->>'title'), ''), '모임'),
    case when v_dn <> '' then v_dn else '게스트' end,
    'joined',
    v_gn
  );

  return jsonb_build_object('guestUserId', v_gn, 'alreadyJoined', false);
end;
$$;

revoke all on function public.meeting_share_guest_join(text, text, text, jsonb) from public;
grant execute on function public.meeting_share_guest_join(text, text, text, jsonb) to anon, authenticated;

create or replace function public.meeting_share_guest_request(
  p_token text,
  p_guest_user_id text,
  p_display_name text,
  p_votes jsonb,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
  v_mid uuid;
  v_ok boolean;
  v_fs jsonb;
  v_gn text;
  v_dn text := left(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g'), 40);
  v_host text;
  v_kicked text[];
  v_jr jsonb;
  v_new_jr jsonb;
  v_msg text;
  v_cfg_msg boolean;
  v_row jsonb;
  v_in_part boolean := false;
  v_known boolean := false;
begin
  select t.o_link_id, t.o_meeting_id, t.o_ok
  into v_link_id, v_mid, v_ok
  from public.meeting_share_try_resolve_token(p_token) as t;
  if not coalesce(v_ok, false) then
    raise exception 'meeting_share_invalid_or_expired_token';
  end if;

  select coalesce(m.extra_data->'fs', '{}'::jsonb)
  into v_fs
  from public.meetings m
  where m.id = v_mid
  for update;

  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  if coalesce((v_fs->>'scheduleConfirmed')::boolean, false) then
    raise exception 'meeting_share_schedule_already_confirmed';
  end if;

  if not public.meeting_share_requires_host_approval(v_fs) then
    raise exception 'meeting_share_use_join_endpoint';
  end if;

  v_host := public.ginit_normalize_app_user_id(coalesce(v_fs->>'createdBy', ''));

  if coalesce(nullif(trim(p_guest_user_id), ''), '') <> ''
     and public.meeting_share_is_ginitweb_guest_id(trim(p_guest_user_id)) then
    v_gn := trim(p_guest_user_id);
    select exists(
      select 1 from jsonb_array_elements_text(coalesce(v_fs->'participantIds', '[]'::jsonb)) x where x = v_gn
    ) into v_known;
    if not v_known then
      select exists(
        select 1 from jsonb_array_elements(coalesce(v_fs->'joinRequests', '[]'::jsonb)) jr
        where jr->>'userId' = v_gn
      ) into v_known;
    end if;
    if not v_known then
      v_gn := 'ginitweb_' || public.meeting_share_gen_uuid_v4()::text;
    end if;
  else
    v_gn := 'ginitweb_' || public.meeting_share_gen_uuid_v4()::text;
  end if;

  if v_gn = v_host then
    raise exception 'meeting_share_invalid_guest';
  end if;

  select coalesce(array_agg(k) filter (where k <> ''), array[]::text[])
  into v_kicked
  from jsonb_array_elements_text(coalesce(v_fs->'kickedParticipantIds', '[]'::jsonb)) as t(k);
  if v_gn = any(v_kicked) then
    raise exception 'meeting_share_guest_kicked';
  end if;

  select exists(
    select 1 from jsonb_array_elements_text(coalesce(v_fs->'participantIds', '[]'::jsonb)) x where x = v_gn
  ) into v_in_part;
  if v_in_part then
    raise exception 'meeting_share_already_participant';
  end if;

  v_cfg_msg := coalesce((v_fs->'meetingConfig'->>'requestMessageEnabled')::boolean, false);
  if v_cfg_msg then
    v_msg := left(regexp_replace(coalesce(p_message, ''), '[[:cntrl:]]', '', 'g'), 200);
    if v_msg = '' then v_msg := null; end if;
  else
    v_msg := null;
  end if;

  v_jr := coalesce(v_fs->'joinRequests', '[]'::jsonb);
  select coalesce(jsonb_agg(e), '[]'::jsonb)
  into v_new_jr
  from jsonb_array_elements(v_jr) e
  where e->>'userId' is distinct from v_gn;

  v_row := jsonb_build_object(
    'userId', v_gn,
    'dateChipIds', to_jsonb(public.meeting_share_vote_string_ids(p_votes, 'dateChipIds')),
    'placeChipIds', to_jsonb(public.meeting_share_vote_string_ids(p_votes, 'placeChipIds')),
    'movieChipIds', to_jsonb(public.meeting_share_vote_string_ids(p_votes, 'movieChipIds')),
    'requestedAt', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))
  );
  if v_cfg_msg and v_msg is not null then
    v_row := v_row || jsonb_build_object('message', v_msg);
  end if;
  if v_dn <> '' then
    v_row := v_row || jsonb_build_object('displayName', v_dn);
  end if;

  v_new_jr := v_new_jr || jsonb_build_array(v_row);
  v_fs := v_fs || jsonb_build_object('joinRequests', v_new_jr, 'id', v_mid::text);

  perform public.meeting_share_sync_meeting_from_fs(v_mid, v_fs);
  update public.meeting_share_links set last_used_at = now() where id = v_link_id;

  perform private.meeting_share_notify_host_web_guest_fcm(
    v_host,
    v_mid,
    coalesce(nullif(trim(v_fs->>'title'), ''), '모임'),
    case when v_dn <> '' then v_dn else '게스트' end,
    'join_requested',
    v_gn
  );

  return jsonb_build_object('guestUserId', v_gn);
end;
$$;

revoke all on function public.meeting_share_guest_request(text, text, text, jsonb, text) from public;
grant execute on function public.meeting_share_guest_request(text, text, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';
