-- 중앙 정책 v2: policy_group + policy_key + JSONB + is_active
-- 기존 app_policies(numeric PK) 및 의존 함수를 교체합니다.

drop function if exists public.apply_meeting_confirm_xp(text, uuid);
drop function if exists public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid);
drop function if exists public.get_app_policy_numeric(text, numeric);

drop table if exists public.app_policies cascade;

create table public.app_policies (
  id uuid primary key default gen_random_uuid(),
  policy_group text not null,
  policy_key text not null,
  policy_value jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  description text,
  updated_at timestamptz not null default now(),
  unique (policy_group, policy_key)
);

create index if not exists app_policies_group_idx on public.app_policies (policy_group);

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values
  ('meeting', 'overlap_hours', '3'::jsonb, true, '확정 일정 기준 앞뒤 겹침 방지(시간)'),
  ('xp', 'meeting_confirm', '50'::jsonb, true, '주최자 일정 확정 XP'),
  ('xp', 'meeting_vote', '20'::jsonb, true, '투표 완료 등 기본 투표 XP'),
  ('trust', 'default_score', '100'::jsonb, true, '신뢰도 기본 상한 참고(프로필 기본값과 별도 운영용)'),
  ('trust', 'penalty_noshow', '{"xp":-100,"trust":-50,"restricted_below":30}'::jsonb, true, '노쇼: XP·gTrust·제한 기준'),
  ('trust', 'penalty_late_cancel', '{"xp":-30,"trust":-10}'::jsonb, true, '늦은 취소 패널티'),
  ('trust', 'penalty_report_approved', '{"trust":-20,"restricted_below":30}'::jsonb, true, '신고 승인 패널티'),
  ('trust', 'recovery_checkin', '{"streak_need":3,"trust_delta":5,"cap":100}'::jsonb, true, '연속 체크인 회복'),
  ('trust', 'min_join_score', '70'::jsonb, true, '모임 참여 최소 gTrust(전역)');

alter table public.app_policies enable row level security;

drop policy if exists app_policies_select_public on public.app_policies;
create policy app_policies_select_public on public.app_policies
for select
using (true);

grant select on public.app_policies to anon, authenticated;

-- JSONB 정책 1건 (활성만)
create or replace function public.get_policy_jsonb(p_group text, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select ap.policy_value
  from public.app_policies ap
  where ap.policy_group = trim(p_group)
    and ap.policy_key = trim(p_key)
    and ap.is_active is true
  limit 1;
$$;

revoke all on function public.get_policy_jsonb(text, text) from public;
grant execute on function public.get_policy_jsonb(text, text) to anon, authenticated, service_role;

-- 스칼라 숫자 JSON 또는 {"value": n} 에서 숫자 추출
create or replace function public.get_policy_numeric(p_group text, p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case jsonb_typeof(j)
        when 'number' then (j::text)::numeric
        when 'object' then coalesce(nullif(trim(j->>'value'), '')::numeric, p_default)
        else p_default
      end
      from (select public.get_policy_jsonb(p_group, p_key) as j) s
    ),
    p_default
  );
$$;

revoke all on function public.get_policy_numeric(text, text, numeric) from public;
grant execute on function public.get_policy_numeric(text, text, numeric) to anon, authenticated, service_role;

-- ─── 일정 겹침 ─────────────────────────────────────────────
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
    and mt.scheduled_at >= (p_start - make_interval(mins => round(v_buf * 60.0)))
    and mt.scheduled_at <= (p_start + make_interval(mins => round(v_buf * 60.0)));

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

-- ─── XP: 확정 ───────────────────────────────────────────────
create or replace function public.apply_meeting_confirm_xp(p_app_user_id text, p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_delta int;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  select id into v_profile_id
  from public.profiles
  where app_user_id = trim(p_app_user_id)
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  v_delta := greatest(
    0,
    round(public.get_policy_numeric('xp', 'meeting_confirm', 50::numeric))::int
  );

  if v_delta <= 0 then
    return;
  end if;

  insert into public.xp_events(profile_id, kind, meeting_id, dedupe_key, xp_delta)
  values (
    v_profile_id,
    'meeting_confirmed',
    p_meeting_id,
    'meeting:' || p_meeting_id::text,
    v_delta
  )
  on conflict do nothing;

  if found then
    update public.profiles
    set g_xp = g_xp + v_delta
    where id = v_profile_id;
  end if;
end;
$$;

revoke all on function public.apply_meeting_confirm_xp(text, uuid) from public;
grant execute on function public.apply_meeting_confirm_xp(text, uuid) to anon, authenticated;

-- ─── XP: 투표(정책 meeting_vote, 클라이언트 p_xp_delta 무시) ──
drop function if exists public.apply_vote_xp(uuid, text, integer, text);

create or replace function public.apply_vote_xp(
  p_meeting_id uuid,
  p_user_id text,
  p_xp_delta int default 0,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_delta int;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  select id into v_profile_id
  from public.profiles
  where app_user_id = p_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_user_id;
  end if;

  v_delta := greatest(
    0,
    round(public.get_policy_numeric('xp', 'meeting_vote', 20::numeric))::int
  );

  insert into public.xp_events(profile_id, kind, meeting_id, dedupe_key, xp_delta)
  values (v_profile_id, 'vote_completed', p_meeting_id, p_dedupe_key, v_delta)
  on conflict do nothing;

  if found then
    update public.profiles
    set g_xp = g_xp + v_delta
    where id = v_profile_id;
  end if;
end;
$$;

revoke all on function public.apply_vote_xp(uuid, text, int, text) from public;
grant execute on function public.apply_vote_xp(uuid, text, int, text) to anon, authenticated;

-- ─── Trust 패널티(정책 JSON) ──────────────────────────────────
create or replace function public.apply_trust_penalty_no_show(
  p_app_user_id text,
  p_dedupe_key text default null
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
  v_inserted boolean := false;
  v_cfg jsonb;
  v_xp_delta int;
  v_trust_delta int;
  v_rb int;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_noshow'),
    '{"xp":-100,"trust":-50,"restricted_below":30}'::jsonb
  );

  v_xp_delta := coalesce((v_cfg->>'xp')::int, -100);
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -50);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

  select id, g_trust, penalty_count, g_xp, is_restricted
  into v_profile_id, v_trust, v_penalty, v_xp, v_restricted
  from public.profiles
  where app_user_id = p_app_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  if p_dedupe_key is not null and length(trim(p_dedupe_key)) > 0 then
    insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
    values (v_profile_id, 'penalty_no_show', trim(p_dedupe_key), v_xp_delta)
    on conflict do nothing
    returning true into v_inserted;
    if not coalesce(v_inserted, false) then
      select g_trust, penalty_count, is_restricted into v_trust, v_penalty, v_restricted
      from public.profiles where id = v_profile_id;
      return query select v_trust, v_penalty, v_restricted;
      return;
    end if;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_penalty := v_penalty + 1;
  v_xp := v_xp + v_xp_delta;
  v_restricted := v_restricted or (v_trust < v_rb);

  update public.profiles
  set
    g_trust = v_trust,
    penalty_count = v_penalty,
    g_xp = v_xp,
    is_restricted = v_restricted,
    trust_recovery_streak = 0
  where id = v_profile_id;

  return query select v_trust, v_penalty, v_restricted;
end;
$$;

create or replace function public.apply_trust_penalty_late_cancel(
  p_app_user_id text,
  p_dedupe_key text default null
)
returns table(new_g_trust int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_trust int;
  v_xp bigint;
  v_inserted boolean := false;
  v_cfg jsonb;
  v_xp_delta int;
  v_trust_delta int;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_late_cancel'),
    '{"xp":-30,"trust":-10}'::jsonb
  );
  v_xp_delta := coalesce((v_cfg->>'xp')::int, -30);
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -10);

  select id, g_trust, g_xp into v_profile_id, v_trust, v_xp
  from public.profiles
  where app_user_id = p_app_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  if p_dedupe_key is not null and length(trim(p_dedupe_key)) > 0 then
    insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
    values (v_profile_id, 'penalty_late_cancel', trim(p_dedupe_key), v_xp_delta)
    on conflict do nothing
    returning true into v_inserted;
    if not coalesce(v_inserted, false) then
      select g_trust into v_trust from public.profiles where id = v_profile_id;
      return query select v_trust;
      return;
    end if;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_xp := v_xp + v_xp_delta;

  update public.profiles
  set g_trust = v_trust, g_xp = v_xp, trust_recovery_streak = 0
  where id = v_profile_id;

  return query select v_trust;
end;
$$;

create or replace function public.apply_trust_penalty_report_approved(
  p_app_user_id text,
  p_dedupe_key text default null
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
  v_restricted boolean;
  v_inserted boolean := false;
  v_cfg jsonb;
  v_trust_delta int;
  v_rb int;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_report_approved'),
    '{"trust":-20,"restricted_below":30}'::jsonb
  );
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -20);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

  select id, g_trust, penalty_count, is_restricted
  into v_profile_id, v_trust, v_penalty, v_restricted
  from public.profiles
  where app_user_id = p_app_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  if p_dedupe_key is not null and length(trim(p_dedupe_key)) > 0 then
    insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
    values (v_profile_id, 'penalty_report_approved', trim(p_dedupe_key), 0)
    on conflict do nothing
    returning true into v_inserted;
    if not coalesce(v_inserted, false) then
      select g_trust, penalty_count, is_restricted into v_trust, v_penalty, v_restricted
      from public.profiles where id = v_profile_id;
      return query select v_trust, v_penalty, v_restricted;
      return;
    end if;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_penalty := v_penalty + 1;
  v_restricted := v_restricted or (v_trust < v_rb);

  update public.profiles
  set
    g_trust = v_trust,
    penalty_count = v_penalty,
    is_restricted = v_restricted,
    trust_recovery_streak = 0
  where id = v_profile_id;

  return query select v_trust, v_penalty, v_restricted;
end;
$$;

create or replace function public.apply_trust_recovery_check_in(
  p_app_user_id text,
  p_meeting_dedupe_key text
)
returns table(new_g_trust int, new_streak int, recovered boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_trust int;
  v_streak int;
  v_recovered boolean := false;
  v_inserted boolean := false;
  v_cfg jsonb;
  v_need int;
  v_add int;
  v_cap int;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' or coalesce(trim(p_meeting_dedupe_key), '') = '' then
    raise exception 'app_user_id and meeting key required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'recovery_checkin'),
    '{"streak_need":3,"trust_delta":5,"cap":100}'::jsonb
  );
  v_need := greatest(1, coalesce((v_cfg->>'streak_need')::int, 3));
  v_add := coalesce((v_cfg->>'trust_delta')::int, 5);
  v_cap := coalesce((v_cfg->>'cap')::int, 100);

  select id, g_trust, trust_recovery_streak into v_profile_id, v_trust, v_streak
  from public.profiles
  where app_user_id = p_app_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
  values (v_profile_id, 'trust_recovery_checkin', trim(p_meeting_dedupe_key), 0)
  on conflict do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    select g_trust, trust_recovery_streak into v_trust, v_streak from public.profiles where id = v_profile_id;
    return query select v_trust, v_streak, false;
    return;
  end if;

  v_streak := v_streak + 1;
  if v_streak >= v_need then
    v_trust := least(v_cap, v_trust + v_add);
    v_streak := 0;
    v_recovered := true;
  end if;

  update public.profiles
  set g_trust = v_trust, trust_recovery_streak = v_streak
  where id = v_profile_id;

  return query select v_trust, v_streak, v_recovered;
end;
$$;

revoke all on function public.apply_trust_penalty_no_show(text, text) from public;
revoke all on function public.apply_trust_penalty_late_cancel(text, text) from public;
revoke all on function public.apply_trust_penalty_report_approved(text, text) from public;
revoke all on function public.apply_trust_recovery_check_in(text, text) from public;

grant execute on function public.apply_trust_penalty_no_show(text, text) to service_role;
grant execute on function public.apply_trust_penalty_late_cancel(text, text) to service_role;
grant execute on function public.apply_trust_penalty_report_approved(text, text) to service_role;
grant execute on function public.apply_trust_recovery_check_in(text, text) to service_role;

-- Realtime: 정책 변경 즉시 반영(대시보드 UPDATE 시 앱 구독)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_policies'
  ) then
    alter publication supabase_realtime add table public.app_policies;
  end if;
exception
  when undefined_object then null;
end;
$$;
