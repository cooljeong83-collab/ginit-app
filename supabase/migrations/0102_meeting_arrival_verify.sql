-- 장소 도착 인증 정책·검증 행·원자적 보상 RPC (XP/gTrust/누적 카운터).
-- Ginit: 보상 수치는 app_policies만 참조. 클라이언트 좌표는 신뢰 불가(스푸핑 가능) — 서버는 모임 확정 좌표 대비 거리·시간만 검증.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting',
  'arrival_verify',
  '{
    "auth_radius_m": 120,
    "window_before_min": 45,
    "window_after_min": 90,
    "min_accuracy_m": 50,
    "xp_reward": 15,
    "trust_reward": 2,
    "trust_cap": 100
  }'::jsonb,
  true,
  '장소 인증: auth_radius_m(미터), window_*_min(예정 시작 scheduled_at 기준 허용 구간), min_accuracy_m(클라이언트 accuracy 상한·휴리스틱), xp_reward/trust_reward(서버만 적용), trust_cap(gTrust 상한).'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

alter table public.profiles
  add column if not exists meeting_arrival_verified_total int not null default 0;

create table if not exists public.meeting_arrival_verifications (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  verified_at timestamptz not null default now(),
  distance_m double precision not null,
  client_accuracy_m double precision,
  unique (meeting_id, profile_id)
);

create index if not exists meeting_arrival_verifications_meeting_idx
  on public.meeting_arrival_verifications (meeting_id);

alter table public.meeting_arrival_verifications enable row level security;

drop policy if exists meeting_arrival_verifications_select on public.meeting_arrival_verifications;
create policy meeting_arrival_verifications_select on public.meeting_arrival_verifications
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = meeting_arrival_verifications.profile_id
      and p.auth_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.meetings m
    where m.id = meeting_arrival_verifications.meeting_id
      and m.created_by_profile_id is not null
      and exists (
        select 1
        from public.profiles hp
        where hp.id = m.created_by_profile_id
          and hp.auth_user_id = auth.uid()
      )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meeting_arrival_verifications'
  ) then
    execute 'alter publication supabase_realtime add table public.meeting_arrival_verifications';
  end if;
end $$;

-- Haversine 거리(미터). 좌표는 도(degree) 단위.
create or replace function public.ginit_haversine_meters(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  with rad as (
    select
      radians(p_lat1) as rlat1,
      radians(p_lon1) as rlon1,
      radians(p_lat2) as rlat2,
      radians(p_lon2) as rlon2
  )
  select case
    when p_lat1 is null or p_lon1 is null or p_lat2 is null or p_lon2 is null then null::double precision
    else (
      6371000.0 * 2.0 * asin(
        least(
          1.0,
          sqrt(
            power(sin((rlat2 - rlat1) / 2.0), 2)
            + cos(rlat1) * cos(rlat2) * power(sin((rlon2 - rlon1) / 2.0), 2)
          )
        )
      )
    )
  end
  from rad;
$$;

revoke all on function public.ginit_haversine_meters(double precision, double precision, double precision, double precision) from public;
grant execute on function public.ginit_haversine_meters(double precision, double precision, double precision, double precision) to anon, authenticated, service_role;

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
begin
  -- Security-definer RPC: 프로필 메트릭 트리거 우회(신뢰도/XP는 정책·원장만 허용).
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

  if not exists (
    select 1
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.profile_id = v_profile_id
  )
  and not (v_host_id is not null and v_host_id = v_profile_id) then
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

  -- 서버 측 accuracy: 클라이언트 값은 스푸핑 가능(약한 휴리스틱). 강한 보증은 불가.
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

  -- Idempotency: xp_events dedupe_key per meeting + kind.
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

notify pgrst, 'reload schema';
