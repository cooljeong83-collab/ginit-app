-- Admin dashboard: DAU slots, daily increment rollups, timeseries RPC

-- ---------------------------------------------------------------------------
-- DAU dedup (minimal storage)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_daily_active_slots (
  activity_date date not null,
  app_user_id text not null,
  primary key (activity_date, app_user_id)
);

create index if not exists admin_daily_active_slots_date_idx
  on public.admin_daily_active_slots (activity_date);

alter table public.admin_daily_active_slots enable row level security;

-- ---------------------------------------------------------------------------
-- Record unique daily active user on login (via session gate)
-- ---------------------------------------------------------------------------
create or replace function public.record_daily_active_user(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(trim(coalesce(p_app_user_id, '')));
  v_inserted boolean := false;
begin
  if v_me = '' then
    return;
  end if;

  if public.is_current_user_admin() then
    return;
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(trim(p.app_user_id)) = v_me
      and lower(trim(coalesce(p.admin, ''))) = 'y'
  ) then
    return;
  end if;

  insert into public.admin_daily_active_slots (activity_date, app_user_id)
  values (current_date, v_me)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  if not v_inserted then
    return;
  end if;

  insert into public.admin_daily_rollups (rollup_date, metric_key, dimension_key, metric_value, payload)
  values (current_date, 'active_users', '_all', 1, null)
  on conflict (rollup_date, metric_key, dimension_key) do update
  set metric_value = public.admin_daily_rollups.metric_value + 1;
end;
$$;

revoke all on function public.record_daily_active_user(text) from public;
grant execute on function public.record_daily_active_user(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Daily rollups (snapshots + increments)
-- ---------------------------------------------------------------------------
create or replace function public.admin_refresh_daily_rollups(p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d date := coalesce(p_date, current_date);
  v_active numeric;
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role'
     and not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;

  select count(*)::numeric into v_active
  from public.admin_daily_active_slots s
  where s.activity_date = v_d;

  insert into public.admin_daily_rollups (rollup_date, metric_key, dimension_key, metric_value, payload)
  values
    (v_d, 'users_total', '_all', (
      select count(*)::numeric from public.profiles where is_withdrawn is not true
    ), null),
    (v_d, 'users_signup_today', '_all', (
      select count(*)::numeric from public.profiles
      where created_at::date = v_d and is_withdrawn is not true
    ), null),
    (v_d, 'daily_signups', '_all', (
      select count(*)::numeric from public.profiles
      where created_at::date = v_d and is_withdrawn is not true
    ), null),
    (v_d, 'meetings_public', '_all', (
      select count(*)::numeric from public.meetings where is_public is true
    ), null),
    (v_d, 'daily_meetings_created', '_all', (
      select count(*)::numeric from public.meetings where created_at::date = v_d
    ), null),
    (v_d, 'reviews_total', '_all', (select count(*)::numeric from public.meeting_reviews), null),
    (v_d, 'daily_reviews_created', '_all', (
      select count(*)::numeric from public.meeting_reviews where created_at::date = v_d
    ), null),
    (v_d, 'admin_pick_total', '_all', (
      select count(*)::numeric from public.meeting_reviews where admin_pick is true
    ), null),
    (v_d, 'reports_pending', '_all', (
      select count(*)::numeric from public.user_reports where status in ('pending', 'reviewing')
    ), null),
    (v_d, 'daily_reports_created', '_all', (
      select count(*)::numeric from public.user_reports where created_at::date = v_d
    ), null),
    (v_d, 'active_users', '_all', v_active, null)
  on conflict (rollup_date, metric_key, dimension_key) do update
  set metric_value = excluded.metric_value,
      payload = excluded.payload;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill missing rollup days in range
-- ---------------------------------------------------------------------------
create or replace function public.admin_ensure_rollups_range(
  p_from date default (current_date - 90),
  p_to date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, current_date - 90);
  v_to date := coalesce(p_to, current_date);
  v_d date;
begin
  perform public.assert_current_user_admin();

  if v_from > v_to then
    return;
  end if;

  for v_d in
    select gs::date
    from generate_series(v_from, v_to, interval '1 day') gs
  loop
    if not exists (
      select 1
      from public.admin_daily_rollups r
      where r.rollup_date = v_d
        and r.metric_key = 'daily_signups'
        and r.dimension_key = '_all'
    ) then
      perform public.admin_refresh_daily_rollups(v_d);
    end if;
  end loop;

  -- Prune old DAU slots (rollup retains active_users per day)
  delete from public.admin_daily_active_slots
  where activity_date < (current_date - 90);
end;
$$;

revoke all on function public.admin_ensure_rollups_range(date, date) from public;
grant execute on function public.admin_ensure_rollups_range(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Timeseries for admin home dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_timeseries(
  p_grain text default 'day',
  p_from date default (current_date - 30),
  p_to date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_grain text := lower(trim(coalesce(p_grain, 'day')));
  v_trunc text;
  v_today date := current_date;
  v_prev_from date;
  v_prev_to date;
  v_span int;
  v_cur_signups numeric := 0;
  v_prev_signups numeric := 0;
  v_cur_active numeric := 0;
  v_prev_active numeric := 0;
  v_delta_signups numeric := null;
  v_delta_active numeric := null;
begin
  perform public.assert_current_user_admin();

  if v_grain not in ('day', 'week', 'month') then
    v_grain := 'day';
  end if;

  v_trunc := case v_grain
    when 'week' then 'week'
    when 'month' then 'month'
    else 'day'
  end;

  if v_from > v_to then
    v_from := v_to;
  end if;

  perform public.admin_ensure_rollups_range(v_from, v_to);
  perform public.admin_refresh_daily_rollups(v_today);

  v_span := greatest(1, (v_to - v_from) + 1);
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - (v_span - 1);

  perform public.admin_ensure_rollups_range(v_prev_from, v_prev_to);

  select coalesce(sum(r.metric_value), 0) into v_cur_signups
  from public.admin_daily_rollups r
  where r.rollup_date between v_from and v_to
    and r.metric_key = 'daily_signups'
    and r.dimension_key = '_all';

  select coalesce(sum(r.metric_value), 0) into v_prev_signups
  from public.admin_daily_rollups r
  where r.rollup_date between v_prev_from and v_prev_to
    and r.metric_key = 'daily_signups'
    and r.dimension_key = '_all';

  select coalesce(sum(r.metric_value), 0) into v_cur_active
  from public.admin_daily_rollups r
  where r.rollup_date between v_from and v_to
    and r.metric_key = 'active_users'
    and r.dimension_key = '_all';

  select coalesce(sum(r.metric_value), 0) into v_prev_active
  from public.admin_daily_rollups r
  where r.rollup_date between v_prev_from and v_prev_to
    and r.metric_key = 'active_users'
    and r.dimension_key = '_all';

  if v_prev_signups > 0 then
    v_delta_signups := (v_cur_signups - v_prev_signups) / v_prev_signups;
  elsif v_cur_signups > 0 then
    v_delta_signups := 1;
  end if;

  if v_prev_active > 0 then
    v_delta_active := (v_cur_active - v_prev_active) / v_prev_active;
  elsif v_cur_active > 0 then
    v_delta_active := 1;
  end if;

  return jsonb_build_object(
    'grain', v_grain,
    'from', v_from,
    'to', v_to,
    'series', coalesce((
      with daily as (
        select
          r.rollup_date,
          coalesce(max(r.metric_value) filter (where r.metric_key = 'daily_signups'), 0) as daily_signups,
          coalesce(max(r.metric_value) filter (where r.metric_key = 'daily_meetings_created'), 0) as daily_meetings_created,
          coalesce(max(r.metric_value) filter (where r.metric_key = 'daily_reviews_created'), 0) as daily_reviews_created,
          coalesce(max(r.metric_value) filter (where r.metric_key = 'daily_reports_created'), 0) as daily_reports_created,
          coalesce(max(r.metric_value) filter (where r.metric_key = 'active_users'), 0) as active_users,
          coalesce(max(r.metric_value) filter (where r.metric_key = 'users_total'), 0) as users_total
        from public.admin_daily_rollups r
        where r.rollup_date between v_from and v_to
          and r.dimension_key = '_all'
          and r.metric_key in (
            'daily_signups', 'daily_meetings_created', 'daily_reviews_created',
            'daily_reports_created', 'active_users', 'users_total'
          )
        group by r.rollup_date
      ),
      daily_period as (
        select
          d.*,
          date_trunc(v_trunc, d.rollup_date)::date as period,
          row_number() over (
            partition by date_trunc(v_trunc, d.rollup_date)
            order by d.rollup_date desc
          ) as rn_last
        from daily d
      ),
      bucketed as (
        select
          dp.period,
          coalesce(sum(dp.daily_signups), 0) as daily_signups,
          coalesce(sum(dp.daily_meetings_created), 0) as daily_meetings_created,
          coalesce(sum(dp.daily_reviews_created), 0) as daily_reviews_created,
          coalesce(sum(dp.daily_reports_created), 0) as daily_reports_created,
          coalesce(sum(dp.active_users), 0) as active_users,
          coalesce(max(dp.users_total) filter (where dp.rn_last = 1), 0) as users_total
        from daily_period dp
        group by dp.period
      )
      select jsonb_agg(
        jsonb_build_object(
          'period', b.period,
          'daily_signups', b.daily_signups,
          'daily_meetings_created', b.daily_meetings_created,
          'daily_reviews_created', b.daily_reviews_created,
          'daily_reports_created', b.daily_reports_created,
          'active_users', b.active_users,
          'users_total', b.users_total
        )
        order by b.period
      )
      from bucketed b
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'users_total', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'users_total' and dimension_key = '_all'
      ), 0),
      'users_signup_today', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'users_signup_today' and dimension_key = '_all'
      ), 0),
      'active_users_today', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'active_users' and dimension_key = '_all'
      ), 0),
      'meetings_public', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'meetings_public' and dimension_key = '_all'
      ), 0),
      'reviews_total', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'reviews_total' and dimension_key = '_all'
      ), 0),
      'admin_pick_total', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'admin_pick_total' and dimension_key = '_all'
      ), 0),
      'reports_pending', coalesce((
        select metric_value from public.admin_daily_rollups
        where rollup_date = v_today and metric_key = 'reports_pending' and dimension_key = '_all'
      ), 0),
      'delta_signups_vs_prev_period', v_delta_signups,
      'delta_active_users_vs_prev_period', v_delta_active
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_timeseries(text, date, date) from public;
grant execute on function public.admin_dashboard_timeseries(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Session gate: record DAU on successful entry
-- ---------------------------------------------------------------------------
create or replace function public.get_account_session_gate(p_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_app_user_id, '')), '');
  v_row public.profiles%rowtype;
  v_allowed boolean := false;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_user', 'message', '사용자 정보가 없습니다.');
  end if;

  if public.is_current_user_admin() then
    v_allowed := true;
  elsif auth.uid() is not null then
    select exists (
      select 1
      from public.profiles p
      where p.auth_user_id = auth.uid()
        and lower(trim(p.app_user_id)) = lower(v_me)
        and coalesce(p.is_withdrawn, false) = false
    ) into v_allowed;
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', '계정을 확인할 수 없습니다.');
  end if;

  select * into v_row
  from public.profiles p
  where lower(trim(p.app_user_id)) = lower(v_me)
  limit 1;

  if not found then
    begin
      perform public.record_daily_active_user(v_me);
    exception when others then
      null;
    end;
    return jsonb_build_object('ok', true);
  end if;

  if coalesce(v_row.is_withdrawn, false) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'withdrawn',
      'message', '탈퇴한 계정입니다. 다시 가입하려면 고객센터에 문의해 주세요.'
    );
  end if;

  if coalesce(v_row.is_suspended, false) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'suspended',
      'message', '운영 정책에 따라 이용이 중지된 계정입니다. 문의가 필요하면 고객센터로 연락해 주세요.'
    );
  end if;

  begin
    perform public.record_daily_active_user(v_me);
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
