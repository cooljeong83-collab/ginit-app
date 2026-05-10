-- 레저 모임: 참가자는 `meeting_participants`에 없고 `extra_data.fs.participantIds`에만 있는 경우가 있어
-- 장소 인증 RPC가 `not_participant`로 막지 않도록 원장 JSON 배열을 함께 본다.

create or replace function public.verify_meeting_arrival_and_reward(
  p_meeting_id uuid,
  p_app_user_id text,
  p_lat double precision,
  p_lng double precision,
  p_client_accuracy_m double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_pol jsonb;
  v_radius_m numeric;
  v_before_min numeric;
  v_after_min numeric;
  v_min_acc numeric;
  v_xp int;
  v_trust_delta int;
  v_trust_cap int;
  v_m_lat double precision;
  v_m_lon double precision;
  v_sched timestamptz;
  v_confirmed boolean;
  v_host_id uuid;
  v_dist double precision;
  v_win_start timestamptz;
  v_win_end timestamptz;
  v_now timestamptz := now();
  v_ins_id uuid;
  v_xp_rows int := 0;
  v_in_participants_table boolean;
  v_in_fs_participant_ids boolean;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if p_meeting_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'meeting_id required');
  end if;

  if p_app_user_id is null or trim(p_app_user_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'app_user_id required');
  end if;

  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'coordinates required');
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.app_user_id = trim(p_app_user_id)
    and p.is_withdrawn is not true
  limit 1;

  if v_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;

  select
    m.latitude,
    m.longitude,
    m.scheduled_at,
    coalesce(m.schedule_confirmed, false),
    m.created_by_profile_id
  into v_m_lat, v_m_lon, v_sched, v_confirmed, v_host_id
  from public.meetings m
  where m.id = p_meeting_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'meeting_not_found');
  end if;

  if v_sched is null then
    return jsonb_build_object('ok', false, 'code', 'meeting_schedule_missing');
  end if;

  if v_confirmed is not true then
    return jsonb_build_object('ok', false, 'code', 'not_confirmed');
  end if;

  if v_m_lat is null or v_m_lon is null then
    return jsonb_build_object('ok', false, 'code', 'meeting_place_missing');
  end if;

  select exists (
    select 1
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.profile_id = v_profile_id
  )
  into v_in_participants_table;

  select exists (
    select 1
    from public.meetings m2
    cross join lateral jsonb_array_elements_text(
      coalesce(
        m2.extra_data->'fs'->'participantIds',
        m2.extra_data->'fs'->'participant_ids',
        '[]'::jsonb
      )
    ) as pid(participant_id)
    where m2.id = p_meeting_id
      and public.ginit_normalize_app_user_id(trim(pid.participant_id))
      = public.ginit_normalize_app_user_id(trim(p_app_user_id))
  )
  into v_in_fs_participant_ids;

  if not (
    v_in_participants_table
    or (v_host_id is not null and v_host_id = v_profile_id)
    or v_in_fs_participant_ids
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_participant');
  end if;

  v_pol := coalesce(public.get_policy_jsonb('meeting', 'arrival_verify'), '{}'::jsonb);

  v_radius_m := coalesce(nullif(trim(v_pol->>'auth_radius_m'), '')::numeric, 120::numeric);
  v_before_min := coalesce(nullif(trim(v_pol->>'window_before_min'), '')::numeric, 45::numeric);
  v_after_min := coalesce(nullif(trim(v_pol->>'window_after_min'), '')::numeric, 90::numeric);
  v_min_acc := coalesce(nullif(trim(v_pol->>'min_accuracy_m'), '')::numeric, 50::numeric);
  v_xp := greatest(0, round(coalesce(nullif(trim(v_pol->>'xp_reward'), '')::numeric, 15::numeric))::int);
  v_trust_delta := greatest(0, round(coalesce(nullif(trim(v_pol->>'trust_reward'), '')::numeric, 2::numeric))::int);
  v_trust_cap := greatest(0, least(100, round(coalesce(nullif(trim(v_pol->>'trust_cap'), '')::numeric, 100::numeric))::int));

  if v_radius_m <= 0 then
    v_radius_m := 120::numeric;
  end if;

  if p_client_accuracy_m is not null and v_min_acc > 0 and p_client_accuracy_m > v_min_acc then
    return jsonb_build_object(
      'ok', false,
      'code', 'client_accuracy_rejected',
      'client_accuracy_m', p_client_accuracy_m,
      'min_accuracy_m', v_min_acc
    );
  end if;

  v_win_start := v_sched - make_interval(mins => greatest(0, v_before_min)::int);
  v_win_end := v_sched + make_interval(mins => greatest(0, v_after_min)::int);

  if v_now < v_win_start then
    return jsonb_build_object('ok', false, 'code', 'too_early');
  end if;

  if v_now > v_win_end then
    return jsonb_build_object('ok', false, 'code', 'too_late');
  end if;

  v_dist := public.ginit_haversine_meters(v_m_lat, v_m_lon, p_lat, p_lng);

  if v_dist is null then
    return jsonb_build_object('ok', false, 'code', 'distance_error');
  end if;

  if v_dist > v_radius_m then
    return jsonb_build_object(
      'ok', false,
      'code', 'too_far',
      'distance_m', v_dist,
      'auth_radius_m', v_radius_m
    );
  end if;

  insert into public.meeting_arrival_verifications (meeting_id, profile_id, distance_m, client_accuracy_m)
  values (p_meeting_id, v_profile_id, v_dist, p_client_accuracy_m)
  on conflict (meeting_id, profile_id) do nothing
  returning id into v_ins_id;

  if v_ins_id is null then
    return jsonb_build_object('ok', false, 'code', 'already_verified', 'distance_m', v_dist);
  end if;

  insert into public.xp_events (profile_id, kind, meeting_id, dedupe_key, xp_delta)
  values (
    v_profile_id,
    'meeting_arrival_verified',
    p_meeting_id,
    'arrival:' || p_meeting_id::text,
    v_xp
  )
  on conflict do nothing;

  get diagnostics v_xp_rows = row_count;
  if v_xp_rows > 0 and v_xp > 0 then
    update public.profiles
    set g_xp = g_xp + v_xp
    where id = v_profile_id;
  end if;

  if v_trust_delta > 0 then
    update public.profiles
    set
      g_trust = least(v_trust_cap, g_trust + v_trust_delta),
      meeting_arrival_verified_total = meeting_arrival_verified_total + 1
    where id = v_profile_id;
  else
    update public.profiles
    set meeting_arrival_verified_total = meeting_arrival_verified_total + 1
    where id = v_profile_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'distance_m', v_dist,
    'xp_granted', case when v_xp_rows > 0 then v_xp else 0 end,
    'trust_granted', v_trust_delta
  );
end;
$$;

revoke all on function public.verify_meeting_arrival_and_reward(uuid, text, double precision, double precision, double precision) from public;
grant execute on function public.verify_meeting_arrival_and_reward(uuid, text, double precision, double precision, double precision) to anon, authenticated;

-- 동일 원인: 참가자 카드용 목록 RPC도 `meeting_participants` 없이 원장 JSON만 있는 뷰어를 허용

create or replace function public.list_meeting_arrival_verified_app_user_ids(
  p_meeting_id uuid,
  p_viewer_app_user_id text
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer_profile_id uuid;
  v_host_id uuid;
  v_confirmed boolean;
  v_ids text[];
  v_in_mp boolean;
  v_in_fs boolean;
begin
  if p_meeting_id is null or p_viewer_app_user_id is null or trim(p_viewer_app_user_id) = '' then
    return '{}'::text[];
  end if;

  select p.id
  into v_viewer_profile_id
  from public.profiles p
  where p.app_user_id = trim(p_viewer_app_user_id)
    and coalesce(p.is_withdrawn, false) is not true
  limit 1;

  if v_viewer_profile_id is null then
    return '{}'::text[];
  end if;

  select m.created_by_profile_id, coalesce(m.schedule_confirmed, false)
  into v_host_id, v_confirmed
  from public.meetings m
  where m.id = p_meeting_id
  limit 1;

  if not found then
    return '{}'::text[];
  end if;

  if v_confirmed is not true then
    return '{}'::text[];
  end if;

  select exists (
    select 1
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.profile_id = v_viewer_profile_id
  )
  into v_in_mp;

  select exists (
    select 1
    from public.meetings m2
    cross join lateral jsonb_array_elements_text(
      coalesce(
        m2.extra_data->'fs'->'participantIds',
        m2.extra_data->'fs'->'participant_ids',
        '[]'::jsonb
      )
    ) as pid(participant_id)
    where m2.id = p_meeting_id
      and public.ginit_normalize_app_user_id(trim(pid.participant_id))
      = public.ginit_normalize_app_user_id(trim(p_viewer_app_user_id))
  )
  into v_in_fs;

  if not (
    v_in_mp
    or (v_host_id is not null and v_host_id = v_viewer_profile_id)
    or v_in_fs
  ) then
    return '{}'::text[];
  end if;

  select coalesce(
    array_agg(distinct trim(p.app_user_id)) filter (where length(trim(p.app_user_id)) > 0),
    '{}'::text[]
  )
  into v_ids
  from public.meeting_arrival_verifications v
  inner join public.profiles p on p.id = v.profile_id
  where v.meeting_id = p_meeting_id
    and coalesce(p.is_withdrawn, false) is not true;

  return coalesce(v_ids, '{}'::text[]);
end;
$$;

revoke all on function public.list_meeting_arrival_verified_app_user_ids(uuid, text) from public;
grant execute on function public.list_meeting_arrival_verified_app_user_ids(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

