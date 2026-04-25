-- 앱 정책 상수(겹침 버퍼 시간, 확정 XP 등) — Supabase에서 조회·캐시해 사용합니다.

create table if not exists public.app_policies (
  policy_key text primary key,
  policy_value numeric not null,
  description text
);

insert into public.app_policies (policy_key, policy_value, description)
values
  ('meeting_overlap_hours', 3, '3시간 중복 방지 규칙(기본 겹침 버퍼 시간, 시간 단위)'),
  ('xp_meeting_confirm', 50, '모임 확정 경험치(주최자 일정 확정 시 부여)')
on conflict (policy_key) do update
set policy_value = excluded.policy_value,
    description = excluded.description;

alter table public.app_policies enable row level security;

drop policy if exists app_policies_select_public on public.app_policies;
create policy app_policies_select_public on public.app_policies
for select
using (true);

grant select on public.app_policies to anon, authenticated;

-- 정책 값 조회(누락 시 기본값). 겹침 RPC·XP RPC에서 사용합니다.
create or replace function public.get_app_policy_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ap.policy_value from public.app_policies ap where ap.policy_key = trim(p_key) limit 1),
    p_default
  );
$$;

revoke all on function public.get_app_policy_numeric(text, numeric) from public;
grant execute on function public.get_app_policy_numeric(text, numeric) to anon, authenticated;

-- 확정 일정 겹침 검사: 기본 버퍼는 app_policies.meeting_overlap_hours
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

  v_default_buf := public.get_app_policy_numeric('meeting_overlap_hours', 3::numeric);
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

-- 주최자 일정 확정 시 XP (정책 xp_meeting_confirm, dedupe: 모임당 1회)
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
    round(public.get_app_policy_numeric('xp_meeting_confirm', 50::numeric))::int
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
