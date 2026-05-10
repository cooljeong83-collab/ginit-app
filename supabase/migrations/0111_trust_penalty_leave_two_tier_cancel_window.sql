-- 확정 모임 퇴장·호스트 확정 취소: 예정 시작 **outer_hours(기본 2)** 이내·시작 전에만 패널티.
-- **inner_hours(기본 1)** 이내는 penalty_* 전액, 그보다 이전·outer 이내는 *_soft(기본 절반).

update public.app_policies
set
  policy_value = '{"outer_hours":2,"inner_hours":1}'::jsonb,
  description =
    '퇴장·호스트 확정 취소 RPC 시간 창: outer_hours(예정 시작 전 이 시간 이내면 패널티 후보), inner_hours(이 이내는 강한 티어 penalty_* , 그보다 바깥·outer 이내는 완화 티어 penalty_*_soft). 시작 시각 이후·outer 시작 이전에는 패널티 없음.',
  updated_at = now()
where policy_group = 'trust'
  and policy_key = 'penalty_near_meeting_cancel_window_hours';

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'trust',
  'penalty_leave_confirmed_soft',
  '{"xp":-15,"trust":-6,"restricted_below":30}'::jsonb,
  true,
  '확정 모임 참여자 퇴장 RPC: 예정 시작 outer~inner 구간에서 적용하는 완화 패널티(inner 이내는 penalty_leave_confirmed).'
)
on conflict (policy_group, policy_key) do update set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'trust',
  'penalty_host_unconfirm_confirmed_soft',
  '{"xp":-15,"trust":-6,"restricted_below":30}'::jsonb,
  true,
  '확정 모임 호스트 확정 취소 RPC: outer~inner 구간 완화 패널티(inner 이내는 penalty_host_unconfirm_confirmed).'
)
on conflict (policy_group, policy_key) do update set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

create or replace function public.apply_trust_penalty_leave_confirmed_meeting(
  p_app_user_id text,
  p_meeting_firestore_id text
)
returns table(new_g_trust int, new_penalty_count int, is_restricted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_trust int;
  v_penalty int;
  v_xp bigint;
  v_restricted boolean;
  v_cfg jsonb;
  v_cfg_full jsonb;
  v_cfg_soft jsonb;
  v_xp_delta int;
  v_trust_delta int;
  v_rb int;
  v_dedupe text;
  v_xp_insert_rowcount int;
  v_mid text;
  v_uuid uuid;
  v_sched timestamptz;
  v_win_cfg jsonb;
  v_outer_hours numeric;
  v_inner_hours numeric;
  v_outer_start timestamptz;
  v_inner_start timestamptz;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;
  if coalesce(trim(p_meeting_firestore_id), '') = '' then
    raise exception 'meeting id required';
  end if;

  v_cfg_full := coalesce(
    public.get_policy_jsonb('trust', 'penalty_leave_confirmed'),
    '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb
  );
  v_cfg_soft := coalesce(
    public.get_policy_jsonb('trust', 'penalty_leave_confirmed_soft'),
    '{"xp":-15,"trust":-6,"restricted_below":30}'::jsonb
  );
  v_cfg := v_cfg_full;
  v_xp_delta := coalesce((v_cfg_full->>'xp')::int, -30);
  v_trust_delta := coalesce((v_cfg_full->>'trust')::int, -12);
  v_rb := coalesce((v_cfg_full->>'restricted_below')::int, 30);

  select prf.id, prf.g_trust, prf.penalty_count, prf.g_xp, prf.is_restricted
  into v_profile_id, v_trust, v_penalty, v_xp, v_restricted
  from public.profiles prf
  where prf.app_user_id = trim(p_app_user_id)
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  v_dedupe := trim(p_meeting_firestore_id);
  v_mid := v_dedupe;
  v_uuid := null;
  v_sched := null;

  if v_mid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    begin
      v_uuid := v_mid::uuid;
    exception
      when others then
        v_uuid := null;
    end;
  end if;

  if v_uuid is not null then
    select m.scheduled_at into v_sched
    from public.meetings m
    where m.id = v_uuid
    limit 1;
  end if;

  if v_sched is not null then
    v_win_cfg := coalesce(
      public.get_policy_jsonb('trust', 'penalty_near_meeting_cancel_window_hours'),
      '{"outer_hours":2,"inner_hours":1}'::jsonb
    );
    v_outer_hours := coalesce(
      nullif(trim(v_win_cfg->>'outer_hours'), '')::numeric,
      nullif(trim(v_win_cfg->>'hours'), '')::numeric,
      2::numeric
    );
    v_inner_hours := coalesce(
      nullif(trim(v_win_cfg->>'inner_hours'), '')::numeric,
      nullif(trim(v_win_cfg->>'hours'), '')::numeric,
      1::numeric
    );
    v_outer_hours := greatest(0.0001::numeric, least(168::numeric, v_outer_hours));
    v_inner_hours := greatest(0.0001::numeric, least(168::numeric, v_inner_hours));
    if v_inner_hours > v_outer_hours then
      v_inner_hours := v_outer_hours;
    end if;
    v_outer_start := v_sched - (v_outer_hours * interval '1 hour');
    v_inner_start := v_sched - (v_inner_hours * interval '1 hour');
    if now() < v_outer_start or now() >= v_sched then
      select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
      from public.profiles prf
      where prf.id = v_profile_id;
      return query select v_trust, v_penalty, v_restricted;
      return;
    end if;
    if now() >= v_inner_start then
      v_cfg := v_cfg_full;
    else
      v_cfg := v_cfg_soft;
    end if;
    v_xp_delta := coalesce((v_cfg->>'xp')::int, -15);
    v_trust_delta := coalesce((v_cfg->>'trust')::int, -6);
    v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);
  end if;

  insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
  values (v_profile_id, 'penalty_leave_confirmed', v_dedupe, v_xp_delta)
  on conflict do nothing;

  get diagnostics v_xp_insert_rowcount = row_count;

  if v_xp_insert_rowcount = 0 then
    select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles prf
    where prf.id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_penalty := v_penalty + 1;
  v_xp := v_xp + v_xp_delta;
  v_restricted := v_restricted or (v_trust < v_rb);

  update public.profiles prf
  set
    (g_trust, penalty_count, g_xp, is_restricted, trust_recovery_streak)
      = (v_trust, v_penalty, v_xp, v_restricted, 0)
  where prf.id = v_profile_id;

  return query select v_trust, v_penalty, v_restricted;
end;
$$;

revoke all on function public.apply_trust_penalty_leave_confirmed_meeting(text, text) from PUBLIC;
grant execute on function public.apply_trust_penalty_leave_confirmed_meeting(text, text) to anon, authenticated, service_role;

create or replace function public.apply_trust_penalty_host_unconfirm_confirmed_meeting(
  p_app_user_id text,
  p_meeting_id uuid
)
returns table(new_g_trust int, new_penalty_count int, is_restricted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_trust int;
  v_penalty int;
  v_xp bigint;
  v_restricted boolean;
  v_cfg jsonb;
  v_cfg_full jsonb;
  v_cfg_soft jsonb;
  v_xp_delta int;
  v_trust_delta int;
  v_rb int;
  v_dedupe text;
  v_xp_insert_rowcount int;
  v_host uuid;
  v_confirmed boolean;
  v_sched timestamptz;
  v_win_cfg jsonb;
  v_outer_hours numeric;
  v_inner_hours numeric;
  v_outer_start timestamptz;
  v_inner_start timestamptz;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;
  if p_meeting_id is null then
    raise exception 'meeting id required';
  end if;

  v_cfg_full := coalesce(
    public.get_policy_jsonb('trust', 'penalty_host_unconfirm_confirmed'),
    '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb
  );
  v_cfg_soft := coalesce(
    public.get_policy_jsonb('trust', 'penalty_host_unconfirm_confirmed_soft'),
    '{"xp":-15,"trust":-6,"restricted_below":30}'::jsonb
  );
  v_cfg := v_cfg_full;
  v_xp_delta := coalesce((v_cfg_full->>'xp')::int, -30);
  v_trust_delta := coalesce((v_cfg_full->>'trust')::int, -12);
  v_rb := coalesce((v_cfg_full->>'restricted_below')::int, 30);

  select prf.id, prf.g_trust, prf.penalty_count, prf.g_xp, prf.is_restricted
  into v_profile_id, v_trust, v_penalty, v_xp, v_restricted
  from public.profiles prf
  where prf.app_user_id = trim(p_app_user_id)
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  select m.created_by_profile_id, coalesce(m.schedule_confirmed, false), m.scheduled_at
  into v_host, v_confirmed, v_sched
  from public.meetings m
  where m.id = p_meeting_id
  limit 1;

  if not found then
    raise exception 'meeting not found';
  end if;

  if v_confirmed is not true then
    raise exception 'meeting not schedule-confirmed';
  end if;

  if v_host is null or v_host <> v_profile_id then
    raise exception 'only host can take this penalty';
  end if;

  if v_sched is null then
    select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles prf
    where prf.id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;

  v_win_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_near_meeting_cancel_window_hours'),
    '{"outer_hours":2,"inner_hours":1}'::jsonb
  );
  v_outer_hours := coalesce(
    nullif(trim(v_win_cfg->>'outer_hours'), '')::numeric,
    nullif(trim(v_win_cfg->>'hours'), '')::numeric,
    2::numeric
  );
  v_inner_hours := coalesce(
    nullif(trim(v_win_cfg->>'inner_hours'), '')::numeric,
    nullif(trim(v_win_cfg->>'hours'), '')::numeric,
    1::numeric
  );
  v_outer_hours := greatest(0.0001::numeric, least(168::numeric, v_outer_hours));
  v_inner_hours := greatest(0.0001::numeric, least(168::numeric, v_inner_hours));
  if v_inner_hours > v_outer_hours then
    v_inner_hours := v_outer_hours;
  end if;
  v_outer_start := v_sched - (v_outer_hours * interval '1 hour');
  v_inner_start := v_sched - (v_inner_hours * interval '1 hour');
  if now() < v_outer_start or now() >= v_sched then
    select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles prf
    where prf.id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;
  if now() >= v_inner_start then
    v_cfg := v_cfg_full;
  else
    v_cfg := v_cfg_soft;
  end if;
  v_xp_delta := coalesce((v_cfg->>'xp')::int, -15);
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -6);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

  v_dedupe := 'host_unconfirm:' || p_meeting_id::text;

  insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
  values (v_profile_id, 'penalty_host_unconfirm', v_dedupe, v_xp_delta)
  on conflict do nothing;

  get diagnostics v_xp_insert_rowcount = row_count;

  if v_xp_insert_rowcount = 0 then
    select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles prf
    where prf.id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_penalty := v_penalty + 1;
  v_xp := v_xp + v_xp_delta;
  v_restricted := v_restricted or (v_trust < v_rb);

  update public.profiles prf
  set
    (g_trust, penalty_count, g_xp, is_restricted, trust_recovery_streak)
      = (v_trust, v_penalty, v_xp, v_restricted, 0)
  where prf.id = v_profile_id;

  return query select v_trust, v_penalty, v_restricted;
end;
$$;

revoke all on function public.apply_trust_penalty_host_unconfirm_confirmed_meeting(text, uuid) from PUBLIC;
grant execute on function public.apply_trust_penalty_host_unconfirm_confirmed_meeting(text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
