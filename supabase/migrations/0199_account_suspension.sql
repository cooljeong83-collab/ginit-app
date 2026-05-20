-- Account suspension (이용 중지) + report approval_action (penalty | suspend)

-- ---------------------------------------------------------------------------
-- profiles: suspension flags
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_suspended boolean not null default false;

alter table public.profiles
  add column if not exists suspended_at timestamptz;

alter table public.profiles
  add column if not exists suspended_by_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_is_suspended_idx
  on public.profiles (is_suspended)
  where is_suspended = true;

-- ---------------------------------------------------------------------------
-- user_reports: approval kind audit
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Session gate (login / app entry)
-- ---------------------------------------------------------------------------
create or replace function public.get_account_session_gate(p_app_user_id text)
returns jsonb
language plpgsql
stable
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

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.get_account_session_gate(text) from public;
grant execute on function public.get_account_session_gate(text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_resolve_user_report (+ approval_action)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_resolve_user_report(uuid, text, text);

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
  v_reported_profile_id uuid;
begin
  perform public.assert_current_user_admin();
  select id into v_admin_id from public.profiles where auth_user_id = auth.uid() limit 1;

  select * into v_row from public.user_reports where id = p_report_id for update;
  if not found then raise exception 'not_found'; end if;

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

    perform public.apply_trust_penalty_report_approved(
      v_row.reported_app_user_id,
      'admin_report:' || p_report_id::text
    );

    if v_action = 'suspend' then
      select id into v_reported_profile_id
      from public.profiles p
      where lower(trim(p.app_user_id)) = lower(trim(v_row.reported_app_user_id))
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

-- ---------------------------------------------------------------------------
-- admin_list_user_reports: include approval_action
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_user_reports(
  p_status text default null,
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
      ur.approval_action,
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

-- ---------------------------------------------------------------------------
-- admin_list_profiles: is_suspended
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
        'is_suspended', x.is_suspended,
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
      coalesce(p.is_suspended, false) as is_suspended,
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

notify pgrst, 'reload schema';
