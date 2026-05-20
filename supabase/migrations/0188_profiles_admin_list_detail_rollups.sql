-- Ginit Admin: profiles.admin, security, rollups, reports, announcements, admin RPCs (additive only)

-- ---------------------------------------------------------------------------
-- profiles.admin
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists admin text not null default 'n';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_admin_yn'
  ) then
    alter table public.profiles
      add constraint profiles_admin_yn check (admin in ('y', 'n'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- IP security
-- ---------------------------------------------------------------------------
create table if not exists public.admin_blocked_ips (
  id uuid primary key default gen_random_uuid(),
  ip inet not null unique,
  reason text not null,
  blocked_at timestamptz not null default now(),
  expires_at timestamptz,
  request_count int,
  created_by_profile_id uuid references public.profiles(id) on delete set null
);

create table if not exists public.admin_ip_allowlist (
  ip inet primary key,
  label text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_security_events (
  id bigserial primary key,
  ip inet,
  event_type text not null,
  path text,
  created_at timestamptz not null default now()
);

create index if not exists admin_security_events_created_at_idx
  on public.admin_security_events (created_at desc);

alter table public.admin_blocked_ips enable row level security;
alter table public.admin_ip_allowlist enable row level security;
alter table public.admin_security_events enable row level security;

-- ---------------------------------------------------------------------------
-- Rollups
-- ---------------------------------------------------------------------------
create table if not exists public.admin_daily_rollups (
  rollup_date date not null,
  metric_key text not null,
  dimension_key text not null default '_all',
  metric_value numeric not null,
  payload jsonb,
  primary key (rollup_date, metric_key, dimension_key)
);

-- ---------------------------------------------------------------------------
-- User reports
-- ---------------------------------------------------------------------------
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_app_user_id text not null,
  reported_app_user_id text not null,
  reason_code text not null,
  description text,
  evidence jsonb,
  status text not null default 'pending',
  priority text not null default 'normal',
  resolved_at timestamptz,
  resolved_by_profile_id uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  constraint user_reports_status_check check (
    status in ('pending', 'reviewing', 'approved', 'dismissed')
  ),
  constraint user_reports_priority_check check (priority in ('normal', 'urgent'))
);

create index if not exists user_reports_status_created_idx
  on public.user_reports (status, created_at desc);

create index if not exists user_reports_reported_idx
  on public.user_reports (reported_app_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  target_type text not null default 'all',
  target_region_norm text,
  status text not null default 'draft',
  published_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint app_announcements_status_check check (
    status in ('draft', 'published', 'archived')
  ),
  constraint app_announcements_target_check check (target_type in ('all', 'region', 'admin_preview'))
);

create table if not exists public.admin_notification_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  urgent_reports boolean not null default true,
  ops_alerts boolean not null default true,
  quiet_hours_start int,
  quiet_hours_end int
);

create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Admin guards
-- ---------------------------------------------------------------------------
create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.admin = 'y'
      and p.is_withdrawn is not true
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

create or replace function public.assert_current_user_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;
end;
$$;

revoke all on function public.assert_current_user_admin() from public;
grant execute on function public.assert_current_user_admin() to authenticated;

create or replace function public.admin_get_session_gate()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
begin
  select * into v_row
  from public.profiles p
  where p.auth_user_id = auth.uid()
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'admin', false, 'reason', 'no_profile');
  end if;

  if v_row.admin is distinct from 'y' then
    return jsonb_build_object(
      'ok', false,
      'admin', false,
      'reason', 'not_admin',
      'profile', jsonb_build_object(
        'id', v_row.id,
        'nickname', v_row.nickname,
        'app_user_id', v_row.app_user_id
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'admin', true,
    'profile', jsonb_build_object(
      'id', v_row.id,
      'nickname', v_row.nickname,
      'app_user_id', v_row.app_user_id,
      'email', v_row.email
    )
  );
end;
$$;

revoke all on function public.admin_get_session_gate() from public;
grant execute on function public.admin_get_session_gate() to authenticated;

-- ---------------------------------------------------------------------------
-- Profiles list / detail
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_profiles(
  p_search text default null,
  p_pending_reports_only boolean default false,
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'app_user_id', x.app_user_id,
        'nickname', x.nickname,
        'created_at', x.created_at,
        'is_withdrawn', x.is_withdrawn,
        'is_restricted', x.is_restricted,
        'g_trust', x.g_trust,
        'pending_reports_count', x.pending_reports_count
      )
      order by x.created_at desc
    ),
    '[]'::jsonb
  ),
  min(x.created_at)
  into v_items, v_next
  from (
    select
      p.id,
      p.app_user_id,
      p.nickname,
      p.created_at,
      p.is_withdrawn,
      p.is_restricted,
      p.g_trust,
      coalesce((
        select count(*)::int
        from public.user_reports ur
        where ur.reported_app_user_id = p.app_user_id
          and ur.status in ('pending', 'reviewing')
      ), 0) as pending_reports_count
    from public.profiles p
    where (p_cursor is null or p.created_at < p_cursor)
      and (
        p_search is null
        or trim(p_search) = ''
        or p.nickname ilike '%' || trim(p_search) || '%'
        or p.app_user_id ilike '%' || trim(p_search) || '%'
        or coalesce(p.email, '') ilike '%' || trim(p_search) || '%'
      )
      and (
        not coalesce(p_pending_reports_only, false)
        or exists (
          select 1 from public.user_reports ur2
          where ur2.reported_app_user_id = p.app_user_id
            and ur2.status in ('pending', 'reviewing')
        )
      )
    order by p.created_at desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'next_cursor', case when jsonb_array_length(coalesce(v_items, '[]'::jsonb)) > v_limit then v_next else null end
  );
end;
$$;

revoke all on function public.admin_list_profiles(text, boolean, int, timestamptz) from public;
grant execute on function public.admin_list_profiles(text, boolean, int, timestamptz) to authenticated;

create or replace function public.admin_get_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'not_found';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_get_profile(uuid) from public;
grant execute on function public.admin_get_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Meetings list / detail
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_meetings(
  p_region_norm text default null,
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at desc nulls last), '[]'::jsonb),
         min(x.scheduled_at)
  into v_items, v_next
  from (
    select
      m.id,
      m.title,
      m.feed_region_norm,
      m.scheduled_at,
      m.is_public,
      coalesce(
        nullif(trim(m.extra_data->'fs'->>'lifecycleStatus'), ''),
        nullif(trim(m.extra_data->>'lifecycleStatus'), ''),
        'unknown'
      ) as lifecycle_status,
      (select count(*)::int from public.meeting_participants mp where mp.meeting_id = m.id) as participant_count
    from public.meetings m
    where (p_cursor is null or m.scheduled_at < p_cursor or m.scheduled_at is null)
      and (
        p_region_norm is null
        or trim(p_region_norm) = ''
        or trim(m.feed_region_norm) = trim(p_region_norm)
      )
    order by m.scheduled_at desc nulls last
    limit v_limit + 1
  ) x;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_meetings(text, int, timestamptz) from public;
grant execute on function public.admin_list_meetings(text, int, timestamptz) to authenticated;

create or replace function public.admin_get_meeting(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m public.meetings%rowtype;
  v_parts jsonb;
begin
  perform public.assert_current_user_admin();
  select * into v_m from public.meetings where id = p_meeting_id;
  if not found then raise exception 'not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'profile_id', mp.profile_id,
    'app_user_id', pr.app_user_id,
    'nickname', pr.nickname
  )), '[]'::jsonb)
  into v_parts
  from public.meeting_participants mp
  inner join public.profiles pr on pr.id = mp.profile_id
  where mp.meeting_id = p_meeting_id;

  return jsonb_build_object(
    'meeting', to_jsonb(v_m),
    'participants', v_parts
  );
end;
$$;

revoke all on function public.admin_get_meeting(uuid) from public;
grant execute on function public.admin_get_meeting(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Meeting reviews
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_meeting_reviews(
  p_region_norm text default null,
  p_admin_pick_only boolean default false,
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
  from (
    select
      r.id,
      r.meeting_id,
      nullif(trim(m.feed_region_norm), '') as region_norm,
      coalesce(nullif(trim(m.place_name), ''), '장소') as place_name,
      r.rating,
      coalesce(r.admin_pick, false) as admin_pick,
      r.created_at
    from public.meeting_reviews r
    inner join public.meetings m on m.id = r.meeting_id
    where (p_cursor is null or r.created_at < p_cursor)
      and (not coalesce(p_admin_pick_only, false) or coalesce(r.admin_pick, false))
      and (
        p_region_norm is null or trim(p_region_norm) = ''
        or trim(m.feed_region_norm) = trim(p_region_norm)
      )
    order by r.created_at desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_meeting_reviews(text, boolean, int, timestamptz) from public;
grant execute on function public.admin_list_meeting_reviews(text, boolean, int, timestamptz) to authenticated;

create or replace function public.admin_get_meeting_review(p_review_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r public.meeting_reviews%rowtype;
  v_m public.meetings%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_r from public.meeting_reviews where id = p_review_id;
  if not found then raise exception 'not_found'; end if;
  select * into v_m from public.meetings where id = v_r.meeting_id;
  return jsonb_build_object('review', to_jsonb(v_r), 'meeting', to_jsonb(v_m));
end;
$$;

revoke all on function public.admin_get_meeting_review(uuid) from public;
grant execute on function public.admin_get_meeting_review(uuid) to authenticated;

create or replace function public.admin_set_meeting_review_admin_pick(
  p_review_id uuid,
  p_admin_pick boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  update public.meeting_reviews
  set
    admin_pick = coalesce(p_admin_pick, false),
    admin_picked_at = case when coalesce(p_admin_pick, false) then now() else null end
  where id = p_review_id;
  if not found then raise exception 'review_not_found'; end if;
end;
$$;

revoke all on function public.admin_set_meeting_review_admin_pick(uuid, boolean) from public;
grant execute on function public.admin_set_meeting_review_admin_pick(uuid, boolean) to authenticated;

create or replace function public.admin_list_review_queue(
  p_region_norm text default null,
  p_limit int default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 1), 1), 5);
begin
  perform public.assert_current_user_admin();
  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
    from (
      select
        r.id as review_id,
        r.meeting_id,
        nullif(trim(m.feed_region_norm), '') as region_norm,
        coalesce(nullif(trim(m.place_name), ''), '장소') as place_name,
        r.rating,
        left(coalesce(r.comment, ''), 120) as comment_preview,
        coalesce(r.admin_pick, false) as admin_pick,
        r.created_at
      from public.meeting_reviews r
      inner join public.meetings m on m.id = r.meeting_id
      where r.comment is not null and trim(r.comment) <> ''
        and (
          p_region_norm is null or trim(p_region_norm) = ''
          or trim(m.feed_region_norm) = trim(p_region_norm)
        )
      order by r.created_at desc
      limit v_limit
    ) x
  );
end;
$$;

revoke all on function public.admin_list_review_queue(text, int) from public;
grant execute on function public.admin_list_review_queue(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard / insights (rollup-backed with live fallback)
-- ---------------------------------------------------------------------------
create or replace function public.admin_refresh_daily_rollups(p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d date := coalesce(p_date, current_date);
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role'
     and not public.is_current_user_admin() then
    raise exception 'forbidden';
  end if;

  insert into public.admin_daily_rollups (rollup_date, metric_key, dimension_key, metric_value, payload)
  values
    (v_d, 'users_total', '_all', (select count(*)::numeric from public.profiles where is_withdrawn is not true), null),
    (v_d, 'users_signup_today', '_all', (
      select count(*)::numeric from public.profiles
      where created_at::date = v_d and is_withdrawn is not true
    ), null),
    (v_d, 'meetings_public', '_all', (select count(*)::numeric from public.meetings where is_public is true), null),
    (v_d, 'reviews_total', '_all', (select count(*)::numeric from public.meeting_reviews), null),
    (v_d, 'admin_pick_total', '_all', (
      select count(*)::numeric from public.meeting_reviews where admin_pick is true
    ), null),
    (v_d, 'reports_pending', '_all', (
      select count(*)::numeric from public.user_reports where status in ('pending', 'reviewing')
    ), null)
  on conflict (rollup_date, metric_key, dimension_key) do update
  set metric_value = excluded.metric_value,
      payload = excluded.payload;
end;
$$;

revoke all on function public.admin_refresh_daily_rollups(date) from public;
grant execute on function public.admin_refresh_daily_rollups(date) to authenticated, service_role;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
begin
  perform public.assert_current_user_admin();
  perform public.admin_refresh_daily_rollups(v_today);

  return jsonb_build_object(
    'users_total', coalesce((
      select metric_value from public.admin_daily_rollups
      where rollup_date = v_today and metric_key = 'users_total' and dimension_key = '_all'
    ), 0),
    'users_signup_today', coalesce((
      select metric_value from public.admin_daily_rollups
      where rollup_date = v_today and metric_key = 'users_signup_today' and dimension_key = '_all'
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
    ), 0)
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

create or replace function public.admin_insights_dashboard(
  p_from date default (current_date - 30),
  p_to date default current_date,
  p_dimension text default 'region',
  p_compare boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, current_date - 30);
  v_to date := coalesce(p_to, current_date);
  v_dim text := coalesce(nullif(trim(p_dimension), ''), 'region');
begin
  perform public.assert_current_user_admin();

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'dimension', v_dim,
    'regions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'region_norm', feed_region_norm,
        'meeting_count', cnt
      ) order by cnt desc)
      from (
        select nullif(trim(feed_region_norm), '') as feed_region_norm, count(*)::int as cnt
        from public.meetings
        where is_public is true
          and feed_region_norm is not null
          and created_at::date between v_from and v_to
        group by 1
        order by cnt desc
        limit 20
      ) t
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', category_id, 'count', cnt) order by cnt desc)
      from (
        select coalesce(category_id, 'unknown') as category_id, count(*)::int as cnt
        from public.meetings
        where created_at::date between v_from and v_to
        group by 1
        order by cnt desc
        limit 15
      ) t
    ), '[]'::jsonb),
    'top_places', coalesce((
      select jsonb_agg(jsonb_build_object('place_name', place_name, 'count', cnt) order by cnt desc)
      from (
        select coalesce(nullif(trim(place_name), ''), '미정') as place_name, count(*)::int as cnt
        from public.meetings
        where created_at::date between v_from and v_to
        group by 1
        order by cnt desc
        limit 10
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_insights_dashboard(date, date, text, boolean) from public;
grant execute on function public.admin_insights_dashboard(date, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies / notifications
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_app_policies()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(ap) order by ap.policy_key)
    from public.app_policies ap
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_app_policies() from public;
grant execute on function public.admin_list_app_policies() to authenticated;

create or replace function public.admin_upsert_app_policy(
  p_key text,
  p_value numeric,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  insert into public.app_policies (policy_key, policy_value, description)
  values (trim(p_key), p_value, p_description)
  on conflict (policy_key) do update
  set policy_value = excluded.policy_value,
      description = coalesce(excluded.description, public.app_policies.description);
end;
$$;

revoke all on function public.admin_upsert_app_policy(text, numeric, text) from public;
grant execute on function public.admin_upsert_app_policy(text, numeric, text) to authenticated;

create or replace function public.admin_list_notifications(
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
  from (
    select id, user_id, type, created_at, read_at
    from public.notifications n
    where p_cursor is null or n.created_at < p_cursor
    order by n.created_at desc
    limit v_limit + 1
  ) x;
  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_notifications(int, timestamptz) from public;
grant execute on function public.admin_list_notifications(int, timestamptz) to authenticated;

create or replace function public.admin_get_notification(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_row public.notifications%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.notifications where id = p_id;
  if not found then raise exception 'not_found'; end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_get_notification(uuid) from public;
grant execute on function public.admin_get_notification(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- User reports admin
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_user_reports(
  p_status text default 'pending',
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
  from (
    select
      ur.id,
      ur.reported_app_user_id,
      coalesce(pr.nickname, ur.reported_app_user_id) as reported_nickname,
      ur.reason_code,
      ur.status,
      ur.priority,
      ur.created_at
    from public.user_reports ur
    left join public.profiles pr on pr.app_user_id = ur.reported_app_user_id
    where (p_cursor is null or ur.created_at < p_cursor)
      and (p_status is null or trim(p_status) = '' or ur.status = p_status)
    order by ur.created_at desc
    limit v_limit + 1
  ) x;
  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_user_reports(text, int, timestamptz) from public;
grant execute on function public.admin_list_user_reports(text, int, timestamptz) to authenticated;

create or replace function public.admin_get_user_report(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_row public.user_reports%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.user_reports where id = p_report_id;
  if not found then raise exception 'not_found'; end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_get_user_report(uuid) from public;
grant execute on function public.admin_get_user_report(uuid) to authenticated;

create or replace function public.admin_resolve_user_report(
  p_report_id uuid,
  p_status text,
  p_resolution_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_reports%rowtype;
  v_admin_id uuid;
begin
  perform public.assert_current_user_admin();
  select id into v_admin_id from public.profiles where auth_user_id = auth.uid() limit 1;

  select * into v_row from public.user_reports where id = p_report_id for update;
  if not found then raise exception 'not_found'; end if;

  update public.user_reports
  set
    status = p_status,
    resolution_note = p_resolution_note,
    resolved_at = now(),
    resolved_by_profile_id = v_admin_id
  where id = p_report_id;

  if p_status = 'approved' then
    perform public.apply_trust_penalty_report_approved(
      v_row.reported_app_user_id,
      'admin_report:' || p_report_id::text
    );
  end if;
end;
$$;

revoke all on function public.admin_resolve_user_report(uuid, text, text) from public;
grant execute on function public.admin_resolve_user_report(uuid, text, text) to authenticated;

create or replace function public.admin_create_user_report(
  p_reported_app_user_id text,
  p_reason_code text,
  p_description text default null,
  p_priority text default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reporter text;
begin
  perform public.assert_current_user_admin();
  select app_user_id into v_reporter from public.profiles where auth_user_id = auth.uid() limit 1;
  insert into public.user_reports (
    reporter_app_user_id, reported_app_user_id, reason_code, description, priority
  )
  values (
    coalesce(v_reporter, 'admin'),
    trim(p_reported_app_user_id),
    trim(p_reason_code),
    p_description,
    coalesce(p_priority, 'normal')
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.admin_create_user_report(text, text, text, text) from public;
grant execute on function public.admin_create_user_report(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_announcements(
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
  from (
    select id, title, status, published_at, target_type, created_at
    from public.app_announcements a
    where p_cursor is null or a.created_at < p_cursor
    order by a.created_at desc
    limit v_limit + 1
  ) x;
  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_announcements(int, timestamptz) from public;
grant execute on function public.admin_list_announcements(int, timestamptz) to authenticated;

create or replace function public.admin_get_announcement(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_row public.app_announcements%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.app_announcements where id = p_id;
  if not found then raise exception 'not_found'; end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_get_announcement(uuid) from public;
grant execute on function public.admin_get_announcement(uuid) to authenticated;

create or replace function public.admin_upsert_announcement(
  p_id uuid default null,
  p_title text default null,
  p_body text default null,
  p_image_url text default null,
  p_target_type text default 'all',
  p_target_region_norm text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_actor uuid;
begin
  perform public.assert_current_user_admin();
  select id into v_actor from public.profiles where auth_user_id = auth.uid() limit 1;

  if v_id is null then
    insert into public.app_announcements (title, body, image_url, target_type, target_region_norm, created_by_profile_id)
    values (
      coalesce(p_title, '제목 없음'),
      coalesce(p_body, ''),
      p_image_url,
      coalesce(p_target_type, 'all'),
      p_target_region_norm,
      v_actor
    )
    returning id into v_id;
  else
    update public.app_announcements
    set
      title = coalesce(p_title, title),
      body = coalesce(p_body, body),
      image_url = coalesce(p_image_url, image_url),
      target_type = coalesce(p_target_type, target_type),
      target_region_norm = coalesce(p_target_region_norm, target_region_norm)
    where id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.admin_upsert_announcement(uuid, text, text, text, text, text) from public;
grant execute on function public.admin_upsert_announcement(uuid, text, text, text, text, text) to authenticated;

-- Publish: default admin_preview only (safe for app — §0.5)
create or replace function public.admin_publish_announcement(
  p_id uuid,
  p_publish_to_users boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.app_announcements%rowtype;
  v_admin_user text;
  v_inserted int := 0;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.app_announcements where id = p_id;
  if not found then raise exception 'not_found'; end if;

  update public.app_announcements
  set status = 'published', published_at = now()
  where id = p_id;

  if coalesce(p_publish_to_users, false) then
    insert into public.notifications (user_id, type, payload)
    select p.app_user_id, 'announcement', jsonb_build_object(
      'announcement_id', p_id,
      'title', v_row.title,
      'image_url', v_row.image_url
    )
    from public.profiles p
    where p.is_withdrawn is not true
      and p.app_user_id is not null
    limit 500;
    get diagnostics v_inserted = row_count;
  else
    select app_user_id into v_admin_user
    from public.profiles where auth_user_id = auth.uid() limit 1;
    if v_admin_user is not null then
      insert into public.notifications (user_id, type, payload)
      values (
        v_admin_user,
        'announcement',
        jsonb_build_object('announcement_id', p_id, 'title', v_row.title, 'preview', true)
      );
      v_inserted := 1;
    end if;
  end if;

  return jsonb_build_object('published', true, 'notifications_inserted', v_inserted);
end;
$$;

revoke all on function public.admin_publish_announcement(uuid, boolean) from public;
grant execute on function public.admin_publish_announcement(uuid, boolean) to authenticated;

-- Categories (read-only list)
create or replace function public.admin_list_meeting_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.sort_order nulls last, c.label)
    from public.meeting_categories c
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_meeting_categories() from public;
grant execute on function public.admin_list_meeting_categories() to authenticated;

-- IP admin RPCs
create or replace function public.admin_list_blocked_ips()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(b) order by b.blocked_at desc)
    from public.admin_blocked_ips b
    where b.expires_at is null or b.expires_at > now()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_blocked_ips() from public;
grant execute on function public.admin_list_blocked_ips() to authenticated;

create or replace function public.admin_block_ip(
  p_ip text,
  p_reason text default 'manual',
  p_hours int default 24
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  insert into public.admin_blocked_ips (ip, reason, expires_at)
  values (p_ip::inet, coalesce(p_reason, 'manual'), now() + make_interval(hours => coalesce(p_hours, 24)))
  on conflict (ip) do update
  set reason = excluded.reason,
      blocked_at = now(),
      expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.admin_block_ip(text, text, int) from public;
grant execute on function public.admin_block_ip(text, text, int) to authenticated;

create or replace function public.admin_unblock_ip(p_ip text)
returns void
language sql
security definer
set search_path = public
as $$
  select public.assert_current_user_admin();
  delete from public.admin_blocked_ips where ip = p_ip::inet;
$$;

revoke all on function public.admin_unblock_ip(text) from public;
grant execute on function public.admin_unblock_ip(text) to authenticated;

create or replace function public.admin_is_ip_blocked(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_blocked_ips b
    where b.ip = p_ip::inet
      and (b.expires_at is null or b.expires_at > now())
  );
$$;

revoke all on function public.admin_is_ip_blocked(text) from public;
grant execute on function public.admin_is_ip_blocked(text) to service_role, authenticated;
