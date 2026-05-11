-- apply_trust_penalty_host_unconfirm_confirmed_meeting: 호스트 판정을 원장(fs.createdBy)과 정렬
--
-- 증상:
-- - 주최 탈퇴 후 방장 이관 시 ledger 문서의 createdBy 는 새 호스트인데,
--   meetings.created_by_profile_id 가 예전 값으로 남은 모임에서
--   확정 취소(근접 취소 패널티 RPC) 시 "only host can take this penalty" 가 발생.
-- - ledger_meeting_put_doc(0116) 이 배포되기 전 이관 데이터 또는 동기화 경로 누락 등.
--
-- 정책:
-- - extra_data.fs.createdBy 가 비어 있지 않고 profiles 에 매칭되면 그 profile id 를
--   유효 호스트로 본다 (0116 ledger_meeting_put_doc 과 동일: lower(trim) 양쪽 비교).
-- - 매칭 실패 시 기존처럼 meetings.created_by_profile_id 를 사용한다.

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
  v_host_col uuid;
  v_host_fs uuid;
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

  select
    m.created_by_profile_id,
    coalesce(m.schedule_confirmed, false),
    m.scheduled_at,
    fs_host.id
  into v_host_col, v_confirmed, v_sched, v_host_fs
  from public.meetings m
  left join lateral (
    select pr.id
    from public.profiles pr
    where nullif(trim(coalesce(m.extra_data#>>'{fs,createdBy}', '')), '') is not null
      and lower(trim(coalesce(pr.app_user_id, ''))) = lower(trim(coalesce(m.extra_data#>>'{fs,createdBy}', '')))
    limit 1
  ) fs_host on true
  where m.id = p_meeting_id
  limit 1;

  if not found then
    raise exception 'meeting not found';
  end if;

  v_host := coalesce(v_host_fs, v_host_col);

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

revoke all on function public.apply_trust_penalty_host_unconfirm_confirmed_meeting(text, uuid) from public;
grant execute on function public.apply_trust_penalty_host_unconfirm_confirmed_meeting(text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
