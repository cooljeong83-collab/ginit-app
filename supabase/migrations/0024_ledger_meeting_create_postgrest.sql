-- PostgREST schema cache에 ledger_meeting_create 가 없을 때(0008 미적용·캐시 미갱신) 대비.
-- 앱은 supabase.rpc('ledger_meeting_create', { p_host_app_user_id, p_doc }) 로 호출합니다.

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

notify pgrst, 'reload schema';
