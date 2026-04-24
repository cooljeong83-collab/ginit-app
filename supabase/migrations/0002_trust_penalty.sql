-- Trust / penalty ledger columns + guarded updates + service-only RPCs.
-- Apply after 0001_hybrid_init.sql

-- 1) Columns (snake_case; app_user_id links to Firestore PK)
alter table public.profiles
  add column if not exists penalty_count int not null default 0,
  add column if not exists is_restricted boolean not null default false,
  add column if not exists trust_recovery_streak int not null default 0;

alter table public.profiles
  drop constraint if exists profiles_g_trust_range;
alter table public.profiles
  add constraint profiles_g_trust_range check (g_trust >= 0 and g_trust <= 100);

-- 2) Block direct client writes to gamification / trust metrics (use RPC or service_role)
create or replace function public.profiles_block_direct_metric_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  jwt_role := coalesce(auth.jwt() ->> 'role', '');
  if jwt_role = 'service_role' then
    return new;
  end if;

  -- Security-definer RPCs (e.g. apply_vote_xp) set this for the same transaction.
  if coalesce(current_setting('ginit.skip_profile_metric_guard', true), '') = '1' then
    return new;
  end if;

  if new.g_trust is distinct from old.g_trust
     or new.g_xp is distinct from old.g_xp
     or new.g_level is distinct from old.g_level
     or new.penalty_count is distinct from old.penalty_count
     or new.is_restricted is distinct from old.is_restricted
     or new.trust_recovery_streak is distinct from old.trust_recovery_streak
  then
    raise exception 'profiles metric fields are not directly updatable; use apply_vote_xp / apply_trust_penalty_* RPC (service role)';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_block_metric_writes on public.profiles;
create trigger trg_profiles_block_metric_writes
before update on public.profiles
for each row execute function public.profiles_block_direct_metric_writes();

-- 3) RPC: no-show (idempotent via xp_events dedupe when xp leg used)
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
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;

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
    values (v_profile_id, 'penalty_no_show', trim(p_dedupe_key), -100)
    on conflict do nothing
    returning true into v_inserted;
    if not coalesce(v_inserted, false) then
      select g_trust, penalty_count, is_restricted into v_trust, v_penalty, v_restricted
      from public.profiles where id = v_profile_id;
      return query select v_trust, v_penalty, v_restricted;
      return;
    end if;
  end if;

  v_trust := greatest(0, v_trust - 50);
  v_penalty := v_penalty + 1;
  v_xp := v_xp - 100;
  v_restricted := v_restricted or (v_trust < 30);

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
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;

  select id, g_trust, g_xp into v_profile_id, v_trust, v_xp
  from public.profiles
  where app_user_id = p_app_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  if p_dedupe_key is not null and length(trim(p_dedupe_key)) > 0 then
    insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
    values (v_profile_id, 'penalty_late_cancel', trim(p_dedupe_key), -30)
    on conflict do nothing
    returning true into v_inserted;
    if not coalesce(v_inserted, false) then
      select g_trust into v_trust from public.profiles where id = v_profile_id;
      return query select v_trust;
      return;
    end if;
  end if;

  v_trust := greatest(0, v_trust - 10);
  v_xp := v_xp - 30;

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
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;

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

  v_trust := greatest(0, v_trust - 20);
  v_penalty := v_penalty + 1;
  v_restricted := v_restricted or (v_trust < 30);

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

-- Recovery: 3 consecutive checked-in meetings → +5 gTrust (capped 100), idempotent per meeting id
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
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' or coalesce(trim(p_meeting_dedupe_key), '') = '' then
    raise exception 'app_user_id and meeting key required';
  end if;

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
  if v_streak >= 3 then
    v_trust := least(100, v_trust + 5);
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

-- 4) Vote XP RPC: allow g_xp updates under the same guard bypass as ledger writes
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
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  select id into v_profile_id
  from public.profiles
  where app_user_id = p_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_user_id;
  end if;

  insert into public.xp_events(profile_id, kind, meeting_id, dedupe_key, xp_delta)
  values (v_profile_id, 'vote_completed', p_meeting_id, p_dedupe_key, coalesce(p_xp_delta, 0))
  on conflict do nothing;

  if found then
    update public.profiles
    set g_xp = g_xp + coalesce(p_xp_delta, 0)
    where id = v_profile_id;
  end if;
end;
$$;
