-- admin_resolve_user_report(승인·패널티): 오버로드 정리, approval_action 컬럼 보강, 프로필 PK 정규화 조회

alter table public.user_reports
  add column if not exists approval_action text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_reports_approval_action_check'
  ) then
    alter table public.user_reports
      add constraint user_reports_approval_action_check check (
        approval_action is null or approval_action in ('penalty', 'suspend')
      );
  end if;
end $$;

drop function if exists public.admin_resolve_user_report(uuid, text, text);
drop function if exists public.admin_resolve_user_report(uuid, text, text, text);

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
  v_norm_id text := public.ginit_normalize_app_user_id(coalesce(p_app_user_id, ''));
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

  if coalesce(v_norm_id, '') = '' then
    raise exception 'app_user_id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_report_approved'),
    '{"trust":-20,"restricted_below":30}'::jsonb
  );
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -20);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

  select p.id, p.g_trust, p.penalty_count, p.is_restricted
  into v_profile_id, v_trust, v_penalty, v_restricted
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id) = v_norm_id
  limit 1;

  if v_profile_id is null then
    raise exception 'reported_profile_not_found';
  end if;

  if p_dedupe_key is not null and length(trim(p_dedupe_key)) > 0 then
    insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
    values (v_profile_id, 'penalty_report_approved', trim(p_dedupe_key), 0)
    on conflict do nothing
    returning true into v_inserted;
    if not coalesce(v_inserted, false) then
      select p.g_trust, p.penalty_count, p.is_restricted
      into v_trust, v_penalty, v_restricted
      from public.profiles p
      where p.id = v_profile_id;
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

create or replace function public.admin_resolve_user_report(
  p_report_id uuid,
  p_status text,
  p_resolution_note text default null,
  p_approval_action text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_reports%rowtype;
  v_admin_id uuid;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_action text := lower(trim(coalesce(p_approval_action, '')));
  v_reported_norm text;
  v_reported_profile_id uuid;
begin
  perform public.assert_current_user_admin();
  select id into v_admin_id from public.profiles where auth_user_id = auth.uid() limit 1;

  select * into v_row from public.user_reports where id = p_report_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  if v_status not in ('pending', 'reviewing', 'approved', 'dismissed') then
    raise exception 'invalid_status';
  end if;

  if v_status = 'dismissed' then
    perform private.purge_user_report_evidence(v_row.evidence);
    delete from public.user_reports where id = p_report_id;
    return;
  end if;

  if v_status = 'approved' then
    if v_action not in ('penalty', 'suspend') then
      raise exception 'invalid_approval_action';
    end if;

    v_reported_norm := public.ginit_normalize_app_user_id(v_row.reported_app_user_id);

    perform public.apply_trust_penalty_report_approved(
      v_reported_norm,
      'admin_report:' || p_report_id::text
    );

    if v_action = 'suspend' then
      select p.id into v_reported_profile_id
      from public.profiles p
      where public.ginit_normalize_app_user_id(p.app_user_id) = v_reported_norm
      limit 1;

      if v_reported_profile_id is not null then
        update public.profiles
        set
          is_suspended = true,
          suspended_at = now(),
          suspended_by_profile_id = v_admin_id
        where id = v_reported_profile_id;
      end if;
    end if;

    update public.user_reports
    set
      status = 'approved',
      approval_action = v_action,
      resolution_note = p_resolution_note,
      resolved_at = now(),
      resolved_by_profile_id = v_admin_id
    where id = p_report_id;
    return;
  end if;

  update public.user_reports
  set
    status = v_status,
    resolution_note = p_resolution_note,
    resolved_at = null,
    resolved_by_profile_id = v_admin_id
  where id = p_report_id;
end;
$$;

revoke all on function public.admin_resolve_user_report(uuid, text, text, text) from public;
grant execute on function public.admin_resolve_user_report(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
