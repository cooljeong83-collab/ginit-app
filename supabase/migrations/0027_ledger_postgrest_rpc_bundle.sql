-- PostgREST schema cache에 ledger / 겹침 관련 RPC가 순차적으로 빠지는 이슈를 한 번에 완화합니다.
-- 앱이 호출하는 함수들을 동일 본문으로 재정의하고, 마지막에 NOTIFY 한 번만 보냅니다.
--
-- 포함: ledger_meeting_put_doc, ledger_list_my_meetings_for_overlap,
--       assert_no_confirmed_schedule_overlap, ledger_meeting_create,
--       ledger_meeting_get_doc, ledger_meeting_delete
--
-- 앱 호출 예:
--   ledger_meeting_put_doc({ p_meeting_id, p_doc })
--   ledger_meeting_get_doc({ p_meeting_id })
--   ledger_meeting_create({ p_host_app_user_id, p_doc })
--   ledger_meeting_delete({ p_meeting_id })
--   ledger_list_my_meetings_for_overlap({ p_app_user_id })
--   assert_no_confirmed_schedule_overlap({ p_app_user_id, p_start, p_buffer_hours, p_exclude_meeting_id })

-- ─── ledger_meeting_put_doc (0008 본문) ─────────────────────────────────────
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

-- ─── ledger_list_my_meetings_for_overlap (0022) ────────────────────────────
create or replace function public.ledger_list_my_meetings_for_overlap(p_app_user_id text)
returns table (
  meeting_id uuid,
  schedule_confirmed boolean,
  scheduled_at timestamptz,
  schedule_date text,
  schedule_time text,
  fs_doc jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    mt.id,
    coalesce(mt.schedule_confirmed, false),
    mt.scheduled_at,
    coalesce(mt.schedule_date, ''),
    coalesce(mt.schedule_time, ''),
    coalesce(mt.extra_data->'fs', '{}'::jsonb)
  from public.meetings mt
  inner join public.meeting_participants mp on mp.meeting_id = mt.id
  inner join public.profiles pr on pr.id = mp.profile_id
  where pr.app_user_id = trim(p_app_user_id);
$$;

revoke all on function public.ledger_list_my_meetings_for_overlap(text) from public;
grant execute on function public.ledger_list_my_meetings_for_overlap(text) to anon, authenticated;

-- ─── assert_no_confirmed_schedule_overlap (0023) ───────────────────────────
create or replace function public.assert_no_confirmed_schedule_overlap(
  p_app_user_id text,
  p_start timestamptz,
  p_buffer_hours numeric default null,
  p_exclude_meeting_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int;
  v_buf numeric;
  v_msg text;
  v_default_buf numeric;
  v_hours int;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' or p_start is null then
    return;
  end if;

  v_default_buf := public.get_policy_numeric('meeting', 'overlap_hours', 3::numeric);
  if v_default_buf is null or v_default_buf <= 0 then
    v_default_buf := 3::numeric;
  end if;

  v_buf := case
    when p_buffer_hours is null or p_buffer_hours <= 0 then v_default_buf
    else p_buffer_hours
  end;

  select count(*)::int into v_cnt
  from public.meetings mt
  inner join public.meeting_participants mp on mp.meeting_id = mt.id
  inner join public.profiles pr on pr.id = mp.profile_id
  where pr.app_user_id = trim(p_app_user_id)
    and mt.schedule_confirmed is true
    and mt.scheduled_at is not null
    and (p_exclude_meeting_id is null or mt.id <> p_exclude_meeting_id)
    and mt.scheduled_at >= (p_start - (v_buf * interval '1 hour'))
    and mt.scheduled_at <= (p_start + (v_buf * interval '1 hour'));

  if v_cnt > 0 then
    v_hours := greatest(1, round(v_buf))::int;
    v_msg := format(
      '이미 해당 시간대 근처(%s시간 이내)에 다른 확정된 약속이 있습니다.',
      v_hours
    );
    raise exception '%', v_msg;
  end if;
end;
$$;

revoke all on function public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid) from public;
grant execute on function public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid) to anon, authenticated;

-- ─── ledger_meeting_create (0024) ───────────────────────────────────────────
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

-- ─── ledger_meeting_get_doc (0025 / 0009) ───────────────────────────────────
create or replace function public.ledger_meeting_get_doc(p_meeting_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
  v_fs jsonb;
  v_created timestamptz;
begin
  if p_meeting_id is null or trim(p_meeting_id) = '' then
    return null;
  end if;
  begin
    v := trim(p_meeting_id)::uuid;
  exception when others then
    return null;
  end;

  select coalesce(m.extra_data->'fs', '{}'::jsonb), m.created_at
  into v_fs, v_created
  from public.meetings m
  where m.id = v;

  if not found then
    return null;
  end if;

  if v_created is not null then
    return v_fs || jsonb_build_object('createdAt', to_jsonb(v_created));
  end if;

  return v_fs;
end;
$$;

revoke all on function public.ledger_meeting_get_doc(text) from public;
grant execute on function public.ledger_meeting_get_doc(text) to anon, authenticated;

-- ─── ledger_meeting_delete (0026) ─────────────────────────────────────────────
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

notify pgrst, 'reload schema';
