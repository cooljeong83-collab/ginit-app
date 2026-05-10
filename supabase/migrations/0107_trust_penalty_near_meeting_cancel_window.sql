-- 확정 모임: 예정 시작 N시간(기본 1시간) 이내에만 퇴장·호스트 확정 취소 시 trust/XP 패널티 적용.
-- 레저 UUID 모임(`public.meetings.scheduled_at`)이 있을 때만 시간 창 검사, 그 외(Firestore id 등)는 기존처럼 패널티 적용.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'trust',
  'penalty_near_meeting_cancel_window_hours',
  '{"hours": 1}'::jsonb,
  true,
  '예정 시작 전 이 시간(시) 이내에만 penalty_leave_confirmed / penalty_host_unconfirm_confirmed RPC가 패널티를 적용합니다. 시작 시각 이후·창 시작 이전에는 패널티 없음.'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'trust',
  'penalty_host_unconfirm_confirmed',
  '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb,
  true,
  '확정 모임을 예정 시작 N시간 이내에 호스트가 확정 취소할 때 적용하는 XP·gTrust·제한 기준(leave_confirmed와 동일 기본값).'
)
on conflict (policy_group, policy_key) do update
set
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
  v_xp_delta int;
  v_trust_delta int;
  v_rb int;
  v_dedupe text;
  v_xp_insert_rowcount int;
  v_mid text;
  v_uuid uuid;
  v_sched timestamptz;
  v_win_cfg jsonb;
  v_win_hours numeric;
  v_win_start timestamptz;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;
  if coalesce(trim(p_meeting_firestore_id), '') = '' then
    raise exception 'meeting id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_leave_confirmed'),
    '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb
  );
  v_xp_delta := coalesce((v_cfg->>'xp')::int, -30);
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -12);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

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
      '{"hours":1}'::jsonb
    );
    v_win_hours := coalesce(nullif(trim(v_win_cfg->>'hours'), '')::numeric, 1::numeric);
    v_win_hours := greatest(0::numeric, least(168::numeric, v_win_hours));
    v_win_start := v_sched - (v_win_hours * interval '1 hour');
    if now() < v_win_start or now() >= v_sched then
      select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
      from public.profiles prf
      where prf.id = v_profile_id;
      return query select v_trust, v_penalty, v_restricted;
      return;
    end if;
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
  v_xp_delta int;
  v_trust_delta int;
  v_rb int;
  v_dedupe text;
  v_xp_insert_rowcount int;
  v_host uuid;
  v_confirmed boolean;
  v_sched timestamptz;
  v_win_cfg jsonb;
  v_win_hours numeric;
  v_win_start timestamptz;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;
  if p_meeting_id is null then
    raise exception 'meeting id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_host_unconfirm_confirmed'),
    '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb
  );
  v_xp_delta := coalesce((v_cfg->>'xp')::int, -30);
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -12);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

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
    '{"hours":1}'::jsonb
  );
  v_win_hours := coalesce(nullif(trim(v_win_cfg->>'hours'), '')::numeric, 1::numeric);
  v_win_hours := greatest(0::numeric, least(168::numeric, v_win_hours));
  v_win_start := v_sched - (v_win_hours * interval '1 hour');
  if now() < v_win_start or now() >= v_sched then
    select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles prf
    where prf.id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;

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
