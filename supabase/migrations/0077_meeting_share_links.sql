-- Web share links: opaque token -> ledger meeting guest read/join/vote (SECURITY DEFINER RPCs).

create extension if not exists pgcrypto;

-- ─── Normalization (align with app: email lower+trim, else trim) ───
create or replace function public.ginit_normalize_app_user_id(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or btrim(p) = '' then ''
    when position('@' in btrim(p)) > 0 then lower(btrim(p))
    else btrim(p)
  end;
$$;

revoke all on function public.ginit_normalize_app_user_id(text) from public;
grant execute on function public.ginit_normalize_app_user_id(text) to anon, authenticated;

-- ─── Table ───
create table if not exists public.meeting_share_links (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  token_hash bytea not null,
  created_by_app_user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create unique index if not exists meeting_share_links_token_hash_uidx
  on public.meeting_share_links (token_hash);

create index if not exists meeting_share_links_meeting_id_idx
  on public.meeting_share_links (meeting_id);

alter table public.meeting_share_links enable row level security;

-- ─── Helpers ───
create or replace function public.meeting_share_is_ginitweb_guest_id(p text)
returns boolean
language sql
immutable
as $$
  select p is not null
    and p ~ '^ginitweb_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$$;

revoke all on function public.meeting_share_is_ginitweb_guest_id(text) from public;
grant execute on function public.meeting_share_is_ginitweb_guest_id(text) to anon, authenticated;

create or replace function public.meeting_share_requires_host_approval(p_fs jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce((p_fs->>'isPublic')::boolean, false) = true
    and coalesce(nullif(trim(p_fs->'meetingConfig'->>'approvalType'), ''), '') = 'HOST_APPROVAL';
$$;

revoke all on function public.meeting_share_requires_host_approval(jsonb) from public;
grant execute on function public.meeting_share_requires_host_approval(jsonb) to anon, authenticated;

create or replace function public.meeting_share_redact_fs(p_fs jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(p_fs, '{}'::jsonb)
    - 'kickedParticipantIds'
    - 'chatReadAtBy'
    - 'chatReadMessageIdBy';
$$;

revoke all on function public.meeting_share_redact_fs(jsonb) from public;
grant execute on function public.meeting_share_redact_fs(jsonb) to anon, authenticated;

create or replace function public.meeting_share_distinct_participant_count(p_fs jsonb)
returns int
language plpgsql
immutable
as $$
declare
  v_host text := public.ginit_normalize_app_user_id(coalesce(p_fs->>'createdBy', ''));
  v_id text;
  v_seen jsonb := '{}'::jsonb;
  v_n int := 0;
begin
  if v_host <> '' then
    v_seen := v_seen || jsonb_build_object(v_host, true);
    v_n := 1;
  end if;
  for v_id in
    select public.ginit_normalize_app_user_id(x)
    from jsonb_array_elements_text(coalesce(p_fs->'participantIds', '[]'::jsonb)) as t(x)
  loop
    if v_id = '' then continue; end if;
    if (v_seen ? v_id) then continue; end if;
    v_seen := v_seen || jsonb_build_object(v_id, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.meeting_share_distinct_participant_count(jsonb) from public;
grant execute on function public.meeting_share_distinct_participant_count(jsonb) to anon, authenticated;

create or replace function public.meeting_share_vote_string_ids(p_votes jsonb, p_key text)
returns text[]
language plpgsql
immutable
as $$
declare
  v_raw jsonb := coalesce(p_votes->p_key, '[]'::jsonb);
  v_out text[] := array[]::text[];
  v_el text;
begin
  if jsonb_typeof(v_raw) <> 'array' then
    return v_out;
  end if;
  for v_el in select j from jsonb_array_elements_text(v_raw) as t(j)
  loop
    if v_el is null or btrim(v_el) = '' then continue; end if;
    v_out := array_append(v_out, v_el);
  end loop;
  return v_out;
end;
$$;

revoke all on function public.meeting_share_vote_string_ids(jsonb, text) from public;
grant execute on function public.meeting_share_vote_string_ids(jsonb, text) to anon, authenticated;

create or replace function public.meeting_share_tally_apply_delta(
  p_tally jsonb,
  p_bucket text,
  p_decr_ids text[],
  p_incr_ids text[]
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_obj jsonb := coalesce(p_tally->p_bucket, '{}'::jsonb);
  v_k text;
  v_n int;
  v_i int;
begin
  if v_obj is null or jsonb_typeof(v_obj) <> 'object' then
    v_obj := '{}'::jsonb;
  end if;
  if p_decr_ids is not null then
    for v_i in 1..coalesce(array_length(p_decr_ids, 1), 0)
    loop
      v_k := p_decr_ids[v_i];
      if v_k is null or v_k = '' then continue; end if;
      v_n := coalesce((v_obj->>v_k)::int, 0) - 1;
      if v_n <= 0 then
        v_obj := v_obj - v_k;
      else
        v_obj := jsonb_set(v_obj, array[v_k], to_jsonb(v_n), true);
      end if;
    end loop;
  end if;
  if p_incr_ids is not null then
    for v_i in 1..coalesce(array_length(p_incr_ids, 1), 0)
    loop
      v_k := p_incr_ids[v_i];
      if v_k is null or v_k = '' then continue; end if;
      v_n := least(1000000, coalesce((v_obj->>v_k)::int, 0) + 1);
      v_obj := jsonb_set(v_obj, array[v_k], to_jsonb(v_n), true);
    end loop;
  end if;
  if v_obj = '{}'::jsonb then
    return null;
  end if;
  return v_obj;
end;
$$;

revoke all on function public.meeting_share_tally_apply_delta(jsonb, text, text[], text[]) from public;
grant execute on function public.meeting_share_tally_apply_delta(jsonb, text, text[], text[]) to anon, authenticated;

-- Sync meetings row from full Firestore-shaped doc (same columns as ledger_meeting_put_doc)
create or replace function public.meeting_share_sync_meeting_from_fs(p_meeting_id uuid, p_doc jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := coalesce(nullif(trim(p_doc->>'title'), ''), '제목 없음');
  v_desc text := coalesce(nullif(trim(p_doc->>'description'), ''), '');
  v_cap int := greatest(1, coalesce((p_doc->>'capacity')::int, 1));
  v_min int := case when p_doc ? 'minParticipants' and p_doc->>'minParticipants' is not null then (p_doc->>'minParticipants')::int else null end;
  v_cat_id text := coalesce(nullif(trim(p_doc->>'categoryId'), ''), '');
  v_cat_lbl text := coalesce(nullif(trim(p_doc->>'categoryLabel'), ''), '');
  v_pub boolean := coalesce((p_doc->>'isPublic')::boolean, false);
  v_img text := nullif(trim(p_doc->>'imageUrl'), '');
  v_place text := coalesce(nullif(trim(p_doc->>'placeName'), ''), '');
  v_addr text := coalesce(nullif(trim(p_doc->>'address'), ''), '');
  v_lat double precision := coalesce((p_doc->>'latitude')::double precision, 0);
  v_lng double precision := coalesce((p_doc->>'longitude')::double precision, 0);
  v_sd text := coalesce(nullif(trim(p_doc->>'scheduleDate'), ''), '');
  v_st text := coalesce(nullif(trim(p_doc->>'scheduleTime'), ''), '');
  v_sched timestamptz := case
    when p_doc ? 'scheduledAt' and p_doc->>'scheduledAt' is not null then (p_doc->>'scheduledAt')::timestamptz
    else null
  end;
  v_conf boolean := coalesce((p_doc->>'scheduleConfirmed')::boolean, false);
  v_cd text := nullif(trim(p_doc->>'confirmedDateChipId'), '');
  v_cp text := nullif(trim(p_doc->>'confirmedPlaceChipId'), '');
  v_cm text := nullif(trim(p_doc->>'confirmedMovieChipId'), '');
begin
  update public.meetings m
  set
    extra_data = jsonb_set(coalesce(m.extra_data, '{}'::jsonb), '{fs}', p_doc, true),
    title = v_title,
    description = nullif(v_desc, ''),
    capacity = v_cap,
    min_participants = v_min,
    category_id = nullif(v_cat_id, ''),
    category_label = nullif(v_cat_lbl, ''),
    is_public = v_pub,
    image_url = nullif(v_img, ''),
    place_name = nullif(v_place, ''),
    address = nullif(v_addr, ''),
    latitude = v_lat,
    longitude = v_lng,
    schedule_date = nullif(v_sd, ''),
    schedule_time = nullif(v_st, ''),
    scheduled_at = v_sched,
    schedule_confirmed = v_conf,
    confirmed_date_chip_id = v_cd,
    confirmed_place_chip_id = v_cp,
    confirmed_movie_chip_id = v_cm,
    place_key = case
      when not (p_doc ? 'placeKey') then m.place_key
      when jsonb_typeof(p_doc->'placeKey') = 'null' then null
      else nullif(trim(p_doc->>'placeKey'), '')
    end,
    updated_at = now()
  where m.id = p_meeting_id;
end;
$$;

revoke all on function public.meeting_share_sync_meeting_from_fs(uuid, jsonb) from public;

-- RETURNS TABLE avoids 42P13 ("result type must be record because of OUT parameters")
-- when tooling or older Postgres parses OUT + implicit return oddly.
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
  begin
    v_hash := digest(decode(v_hex, 'hex'), 'sha256');
  exception when others then
    return query select null::uuid, null::uuid, false;
    return;
  end;
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

-- ─── meeting_share_create ───
create or replace function public.meeting_share_create(p_meeting_id text, p_host_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_jwt text := public.ginit_normalize_app_user_id(coalesce(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''));
  v_host_param text := public.ginit_normalize_app_user_id(coalesce(p_host_app_user_id, ''));
  v_fs jsonb;
  v_created_by text;
  v_secret_hex text;
  v_hash bytea;
  v_link_id uuid;
  v_expires timestamptz := now() + interval '365 days';
begin
  if v_jwt = '' then
    raise exception 'meeting_share_auth_required';
  end if;
  if v_host_param = '' or v_host_param is distinct from v_jwt then
    raise exception 'meeting_share_host_mismatch';
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
  if v_created_by = '' or v_created_by is distinct from v_jwt then
    raise exception 'meeting_share_not_meeting_host';
  end if;

  v_secret_hex := encode(gen_random_bytes(32), 'hex');
  v_hash := digest(decode(v_secret_hex, 'hex'), 'sha256');

  insert into public.meeting_share_links (meeting_id, token_hash, created_by_app_user_id, expires_at)
  values (v_mid, v_hash, v_host_param, v_expires)
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

-- ─── meeting_share_guest_get ───
create or replace function public.meeting_share_guest_get(p_token text)
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
  v_out jsonb;
  v_created timestamptz;
begin
  select t.o_link_id, t.o_meeting_id, t.o_ok
  into v_link_id, v_mid, v_ok
  from public.meeting_share_try_resolve_token(p_token) as t;
  if not coalesce(v_ok, false) then
    raise exception 'meeting_share_invalid_or_expired_token';
  end if;

  update public.meeting_share_links
  set last_used_at = now()
  where id = v_link_id;

  select coalesce(m.extra_data->'fs', '{}'::jsonb), m.created_at
  into v_fs, v_created
  from public.meetings m
  where m.id = v_mid;

  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  v_out := public.meeting_share_redact_fs(v_fs) || jsonb_build_object('id', v_mid::text);
  if v_created is not null then
    v_out := v_out || jsonb_build_object('createdAt', to_jsonb(v_created));
  end if;

  return jsonb_build_object(
    'meeting', v_out,
    'requiresHostApproval', public.meeting_share_requires_host_approval(v_fs)
  );
end;
$$;

revoke all on function public.meeting_share_guest_get(text) from public;
grant execute on function public.meeting_share_guest_get(text) to anon, authenticated;

-- ─── meeting_share_guest_join (OPEN) ───
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
      v_gn := 'ginitweb_' || gen_random_uuid()::text;
    end if;
  else
    v_gn := 'ginitweb_' || gen_random_uuid()::text;
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

-- ─── meeting_share_guest_request (HOST_APPROVAL) ───
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
      v_gn := 'ginitweb_' || gen_random_uuid()::text;
    end if;
  else
    v_gn := 'ginitweb_' || gen_random_uuid()::text;
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
    'requestedAt', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
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

-- ─── meeting_share_guest_vote (participantIds OR pending joinRequests) ───
create or replace function public.meeting_share_guest_vote(
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
  v_gn text := trim(coalesce(p_guest_user_id, ''));
  v_dn text := left(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g'), 40);
  v_in_part boolean := false;
  v_in_jr boolean := false;
  v_old jsonb;
  v_tally jsonb;
  v_dates_old text[];
  v_places_old text[];
  v_movies_old text[];
  v_dates_new text[];
  v_places_new text[];
  v_movies_new text[];
  v_new_log jsonb;
  v_row jsonb;
  v_jr jsonb;
  v_new_jr jsonb;
  v_elem jsonb;
  v_cfg_msg boolean;
  v_i int;
begin
  if not public.meeting_share_is_ginitweb_guest_id(v_gn) then
    raise exception 'meeting_share_invalid_guest_id';
  end if;

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

  v_dates_new := public.meeting_share_vote_string_ids(p_votes, 'dateChipIds');
  v_places_new := public.meeting_share_vote_string_ids(p_votes, 'placeChipIds');
  v_movies_new := public.meeting_share_vote_string_ids(p_votes, 'movieChipIds');

  select exists(
    select 1 from jsonb_array_elements_text(coalesce(v_fs->'participantIds', '[]'::jsonb)) x where x = v_gn
  ) into v_in_part;

  select exists(
    select 1 from jsonb_array_elements(coalesce(v_fs->'joinRequests', '[]'::jsonb)) jr where jr->>'userId' = v_gn
  ) into v_in_jr;

  if not v_in_part and not v_in_jr then
    raise exception 'meeting_share_guest_not_joined';
  end if;

  if v_in_part then
    v_old := null;
    select e into v_old
    from jsonb_array_elements(coalesce(v_fs->'participantVoteLog', '[]'::jsonb)) e
    where e->>'userId' = v_gn
    limit 1;

    if v_old is null then
      v_dates_old := array[]::text[];
      v_places_old := array[]::text[];
      v_movies_old := array[]::text[];
    else
      v_dates_old := public.meeting_share_vote_string_ids(v_old, 'dateChipIds');
      v_places_old := public.meeting_share_vote_string_ids(v_old, 'placeChipIds');
      v_movies_old := public.meeting_share_vote_string_ids(v_old, 'movieChipIds');
    end if;

    v_tally := coalesce(v_fs->'voteTallies', '{}'::jsonb);
    v_tally := jsonb_strip_nulls(
      jsonb_build_object(
        'dates', public.meeting_share_tally_apply_delta(v_tally, 'dates', v_dates_old, v_dates_new),
        'places', public.meeting_share_tally_apply_delta(v_tally, 'places', v_places_old, v_places_new),
        'movies', public.meeting_share_tally_apply_delta(v_tally, 'movies', v_movies_old, v_movies_new)
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

    v_fs := v_fs || jsonb_build_object('voteTallies', v_tally, 'participantVoteLog', v_new_log, 'id', v_mid::text);
  else
    -- pending join request: replace row for this guest
    v_cfg_msg := coalesce((v_fs->'meetingConfig'->>'requestMessageEnabled')::boolean, false);
    v_jr := coalesce(v_fs->'joinRequests', '[]'::jsonb);
    v_new_jr := '[]'::jsonb;
    for v_i in 0 .. greatest(coalesce(jsonb_array_length(v_jr), 0) - 1, -1)
    loop
      if v_i < 0 then exit; end if;
      v_elem := v_jr->v_i;
      if v_elem->>'userId' is distinct from v_gn then
        v_new_jr := v_new_jr || jsonb_build_array(v_elem);
      else
        v_row := jsonb_build_object(
          'userId', v_gn,
          'dateChipIds', to_jsonb(public.meeting_share_vote_string_ids(p_votes, 'dateChipIds')),
          'placeChipIds', to_jsonb(public.meeting_share_vote_string_ids(p_votes, 'placeChipIds')),
          'movieChipIds', to_jsonb(public.meeting_share_vote_string_ids(p_votes, 'movieChipIds')),
          'requestedAt', coalesce(v_elem->'requestedAt', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        );
        if v_cfg_msg and v_elem ? 'message' then
          v_row := v_row || jsonb_build_object('message', v_elem->'message');
        end if;
        if v_dn <> '' then
          v_row := v_row || jsonb_build_object('displayName', v_dn);
        elsif v_elem ? 'displayName' then
          v_row := v_row || jsonb_build_object('displayName', v_elem->'displayName');
        end if;
        v_new_jr := v_new_jr || jsonb_build_array(v_row);
      end if;
    end loop;
    v_fs := v_fs || jsonb_build_object('joinRequests', v_new_jr, 'id', v_mid::text);
  end if;

  perform public.meeting_share_sync_meeting_from_fs(v_mid, v_fs);
  update public.meeting_share_links set last_used_at = now() where id = v_link_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.meeting_share_guest_vote(text, text, text, jsonb) from public;
grant execute on function public.meeting_share_guest_vote(text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
