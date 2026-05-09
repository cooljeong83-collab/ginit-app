-- meeting share: run without pgcrypto extension (gen_random_bytes/digest/gen_random_uuid).
-- Some environments disallow CREATE EXTENSION; this migration removes the dependency.

-- ─── UUID v4 generator (no extensions) ───
create or replace function public.meeting_share_gen_uuid_v4()
returns uuid
language plpgsql
volatile
as $$
declare
  h text := md5(random()::text || clock_timestamp()::text || random()::text);
  v text;
begin
  -- h: 32 hex. Force version=4 and variant=8 to match meeting_share_is_ginitweb_guest_id regex.
  v :=
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    '4' || substr(h, 14, 3) || '-' ||
    '8' || substr(h, 18, 3) || '-' ||
    substr(h, 21, 12);
  return v::uuid;
end;
$$;

revoke all on function public.meeting_share_gen_uuid_v4() from public;
grant execute on function public.meeting_share_gen_uuid_v4() to anon, authenticated;

-- Ensure meeting_share_links.id default works without pgcrypto (gen_random_uuid).
alter table public.meeting_share_links
  alter column id set default public.meeting_share_gen_uuid_v4();

-- ─── Token resolver (md5 hash, no digest) ───
create or replace function public.meeting_share_try_resolve_token(p_token text)
returns table(o_link_id uuid, o_meeting_id uuid, o_ok boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_hex text := lower(regexp_replace(coalesce(p_token, ''), '\s', '', 'g'));
  v_hash bytea;
  v_lid uuid;
  v_mid uuid;
begin
  if length(v_hex) <> 64 or v_hex !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, null::uuid, false;
    return;
  end if;

  -- We store token_hash as bytea = decode(md5(token_hex), 'hex') (16 bytes).
  v_hash := decode(md5(v_hex), 'hex');

  select l.id, l.meeting_id into v_lid, v_mid
  from public.meeting_share_links l
  where l.token_hash = v_hash
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
  limit 1;

  if found then
    return query select v_lid, v_mid, true;
  else
    return query select null::uuid, null::uuid, false;
  end if;
end;
$$;

revoke all on function public.meeting_share_try_resolve_token(text) from public;

-- ─── meeting_share_create (no gen_random_bytes/digest) ───
create or replace function public.meeting_share_create(p_meeting_id text, p_host_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_jwt_claim text := public.ginit_normalize_app_user_id(coalesce(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''));
  v_host_param text := public.ginit_normalize_app_user_id(coalesce(p_host_app_user_id, ''));
  v_caller text;
  v_fs jsonb;
  v_created_by text;
  v_secret_hex text;
  v_hash bytea;
  v_link_id uuid;
  v_expires timestamptz := now() + interval '365 days';
begin
  if v_jwt_claim <> '' then
    if v_host_param = '' or v_host_param is distinct from v_jwt_claim then
      raise exception 'meeting_share_host_mismatch';
    end if;
    v_caller := v_jwt_claim;
  else
    if v_host_param = '' then
      raise exception 'meeting_share_auth_required';
    end if;
    v_caller := v_host_param;
  end if;

  begin
    v_mid := trim(p_meeting_id)::uuid;
  exception when others then
    raise exception 'meeting_share_invalid_meeting_id';
  end;

  select coalesce(m.extra_data->'fs', '{}'::jsonb)
  into v_fs
  from public.meetings m
  where m.id = v_mid;
  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  v_created_by := public.ginit_normalize_app_user_id(coalesce(v_fs->>'createdBy', ''));
  if v_created_by = '' or v_created_by is distinct from v_caller then
    raise exception 'meeting_share_not_meeting_host';
  end if;

  -- 64-hex opaque token (two md5 blocks). Hash is md5(token_hex) stored as bytea (16 bytes).
  v_secret_hex := md5(random()::text || clock_timestamp()::text || v_mid::text || v_caller) ||
                  md5(random()::text || clock_timestamp()::text || v_caller || v_mid::text);
  v_hash := decode(md5(v_secret_hex), 'hex');

  insert into public.meeting_share_links (meeting_id, token_hash, created_by_app_user_id, expires_at)
  values (v_mid, v_hash, v_caller, v_expires)
  returning id into v_link_id;

  return jsonb_build_object(
    'token', v_secret_hex,
    'shareId', v_link_id::text,
    'meetingId', v_mid::text,
    'expiresAt', to_jsonb(v_expires)
  );
end;
$$;

revoke all on function public.meeting_share_create(text, text) from public;
grant execute on function public.meeting_share_create(text, text) to anon, authenticated;

-- ─── Guest id generation: replace gen_random_uuid() ───
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

  return jsonb_build_object('guestUserId', v_gn);
end;
$$;

revoke all on function public.meeting_share_guest_request(text, text, text, jsonb, text) from public;
grant execute on function public.meeting_share_guest_request(text, text, text, jsonb, text) to anon, authenticated;

notify pgrst, 'reload schema';

