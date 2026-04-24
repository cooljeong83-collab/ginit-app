-- Ledger RPCs: Firebase Auth 앱이 Supabase anon으로 프로필·모임(비실시간)을 읽고/쓸 때 사용합니다.
-- security definer — 운영 시 Edge + 토큰 검증으로 대체·보강 권장.

alter table public.profiles
  add column if not exists signup_provider text;

-- ─── 프로필 ───────────────────────────────────────────────────────────

create or replace function public.ensure_profile_minimal(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := '모임친구' || substr(md5(random()::text), 1, 6);
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;
  insert into public.profiles (app_user_id, nickname)
  values (trim(p_app_user_id), v_nick)
  on conflict (app_user_id) do nothing;
end;
$$;

revoke all on function public.ensure_profile_minimal(text) from public;
grant execute on function public.ensure_profile_minimal(text) to anon, authenticated;

create or replace function public.upsert_profile_payload(p_app_user_id text, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  perform public.ensure_profile_minimal(p_app_user_id);

  update public.profiles p
  set
    updated_at = now(),
    nickname = case when p_fields ? 'nickname' then coalesce(nullif(trim(p_fields->>'nickname'), ''), p.nickname) else p.nickname end,
    photo_url = case when p_fields ? 'photo_url' then nullif(trim(p_fields->>'photo_url'), '') else p.photo_url end,
    phone = case when p_fields ? 'phone' then nullif(trim(p_fields->>'phone'), '') else p.phone end,
    phone_verified_at = case
      when p_fields ? 'phone_verified_at' and p_fields->>'phone_verified_at' is not null
      then (p_fields->>'phone_verified_at')::timestamptz
      else p.phone_verified_at
    end,
    email = case when p_fields ? 'email' then nullif(trim(p_fields->>'email'), '') else p.email end,
    display_name = case when p_fields ? 'display_name' then nullif(trim(p_fields->>'display_name'), '') else p.display_name end,
    terms_agreed_at = case
      when p_fields ? 'terms_agreed_at' and p_fields->>'terms_agreed_at' is not null
      then (p_fields->>'terms_agreed_at')::timestamptz
      else p.terms_agreed_at
    end,
    gender = case when p_fields ? 'gender' then nullif(trim(p_fields->>'gender'), '') else p.gender end,
    age_band = case when p_fields ? 'age_band' then nullif(trim(p_fields->>'age_band'), '') else p.age_band end,
    birth_year = case when p_fields ? 'birth_year' and p_fields->>'birth_year' is not null then (p_fields->>'birth_year')::int else p.birth_year end,
    birth_month = case when p_fields ? 'birth_month' and p_fields->>'birth_month' is not null then (p_fields->>'birth_month')::int else p.birth_month end,
    birth_day = case when p_fields ? 'birth_day' and p_fields->>'birth_day' is not null then (p_fields->>'birth_day')::int else p.birth_day end,
    g_level = case when p_fields ? 'g_level' and p_fields->>'g_level' is not null then (p_fields->>'g_level')::int else p.g_level end,
    g_xp = case when p_fields ? 'g_xp' and p_fields->>'g_xp' is not null then (p_fields->>'g_xp')::bigint else p.g_xp end,
    g_trust = case when p_fields ? 'g_trust' and p_fields->>'g_trust' is not null then (p_fields->>'g_trust')::int else p.g_trust end,
    g_dna = case when p_fields ? 'g_dna' then coalesce(nullif(trim(p_fields->>'g_dna'), ''), p.g_dna) else p.g_dna end,
    meeting_count = case when p_fields ? 'meeting_count' and p_fields->>'meeting_count' is not null then (p_fields->>'meeting_count')::int else p.meeting_count end,
    ranking_points = case when p_fields ? 'ranking_points' and p_fields->>'ranking_points' is not null then (p_fields->>'ranking_points')::int else p.ranking_points end,
    is_withdrawn = case when p_fields ? 'is_withdrawn' then (p_fields->>'is_withdrawn')::boolean else p.is_withdrawn end,
    withdrawn_at = case
      when p_fields ? 'withdrawn_at' and p_fields->>'withdrawn_at' is not null
      then (p_fields->>'withdrawn_at')::timestamptz
      else p.withdrawn_at
    end,
    signup_provider = case when p_fields ? 'signup_provider' then nullif(trim(p_fields->>'signup_provider'), '') else p.signup_provider end
  where p.app_user_id = trim(p_app_user_id);
end;
$$;

revoke all on function public.upsert_profile_payload(text, jsonb) from public;
grant execute on function public.upsert_profile_payload(text, jsonb) to anon, authenticated;

-- ─── 모임 (extra_data.fs = Firestore 형태 camelCase JSON) ─────────────

create or replace function public.ledger_meeting_create(p_host_app_user_id text, p_doc jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_id uuid := gen_random_uuid();
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
  v_fs jsonb := p_doc || jsonb_build_object('id', v_id::text);
begin
  if p_host_app_user_id is null or trim(p_host_app_user_id) = '' then
    raise exception 'host app_user_id required';
  end if;

  select id into v_host from public.profiles where app_user_id = trim(p_host_app_user_id) limit 1;
  if v_host is null then
    perform public.ensure_profile_minimal(p_host_app_user_id);
    select id into v_host from public.profiles where app_user_id = trim(p_host_app_user_id) limit 1;
  end if;

  insert into public.meetings (
    id,
    title,
    description,
    capacity,
    min_participants,
    category_id,
    category_label,
    is_public,
    image_url,
    place_name,
    address,
    latitude,
    longitude,
    schedule_date,
    schedule_time,
    scheduled_at,
    schedule_confirmed,
    created_by_profile_id,
    extra_data
  )
  values (
    v_id,
    v_title,
    nullif(v_desc, ''),
    v_cap,
    v_min,
    nullif(v_cat_id, ''),
    nullif(v_cat_lbl, ''),
    v_pub,
    nullif(v_img, ''),
    nullif(v_place, ''),
    nullif(v_addr, ''),
    v_lat,
    v_lng,
    nullif(v_sd, ''),
    nullif(v_st, ''),
    v_sched,
    coalesce((p_doc->>'scheduleConfirmed')::boolean, false),
    v_host,
    jsonb_build_object('fs', v_fs)
  );

  insert into public.meeting_participants (meeting_id, profile_id, role)
  values (v_id, v_host, 'host')
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.ledger_meeting_create(text, jsonb) from public;
grant execute on function public.ledger_meeting_create(text, jsonb) to anon, authenticated;

create or replace function public.ledger_meeting_get_doc(p_meeting_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
  v_fs jsonb;
begin
  if p_meeting_id is null or trim(p_meeting_id) = '' then
    return null;
  end if;
  v := p_meeting_id::uuid;
  select coalesce(m.extra_data->'fs', '{}'::jsonb)
  into v_fs
  from public.meetings m
  where m.id = v;
  return v_fs;
end;
$$;

revoke all on function public.ledger_meeting_get_doc(text) from public;
grant execute on function public.ledger_meeting_get_doc(text) to anon, authenticated;

create or replace function public.ledger_meeting_put_doc(p_meeting_id text, p_doc jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := p_meeting_id::uuid;
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
    updated_at = now()
  where m.id = v;
end;
$$;

revoke all on function public.ledger_meeting_put_doc(text, jsonb) from public;
grant execute on function public.ledger_meeting_put_doc(text, jsonb) to anon, authenticated;

create or replace function public.ledger_meeting_delete(p_meeting_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.meetings where id = p_meeting_id::uuid;
end;
$$;

revoke all on function public.ledger_meeting_delete(text) from public;
grant execute on function public.ledger_meeting_delete(text) to anon, authenticated;
