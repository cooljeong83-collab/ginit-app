-- Admin reports: richer list + detail (reporter/reported context)

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
  v_status text := nullif(lower(trim(coalesce(p_status, ''))), '');
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
      ur.reporter_app_user_id,
      coalesce(pr_rep.nickname, ur.reporter_app_user_id) as reporter_nickname,
      ur.reported_app_user_id,
      coalesce(pr.nickname, ur.reported_app_user_id) as reported_nickname,
      ur.reason_code,
      ur.status,
      ur.priority,
      ur.approval_action,
      nullif(left(trim(coalesce(ur.description, '')), 120), '') as description_preview,
      ur.created_at
    from public.user_reports ur
    left join public.profiles pr
      on public.ginit_normalize_app_user_id(pr.app_user_id)
       = public.ginit_normalize_app_user_id(ur.reported_app_user_id)
    left join public.profiles pr_rep
      on public.ginit_normalize_app_user_id(pr_rep.app_user_id)
       = public.ginit_normalize_app_user_id(ur.reporter_app_user_id)
    where (p_cursor is null or ur.created_at < p_cursor)
      and (
        v_status is null
        or (v_status = 'open' and ur.status in ('pending', 'reviewing'))
        or (v_status is distinct from 'open' and ur.status = v_status)
      )
    order by
      case when ur.priority = 'urgent' then 0 else 1 end,
      ur.created_at desc
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
declare
  v_row public.user_reports%rowtype;
  v_reporter_nickname text;
  v_reported_nickname text;
  v_reported_profile jsonb;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.user_reports where id = p_report_id;
  if not found then
    raise exception 'not_found';
  end if;

  select coalesce(nullif(trim(p.nickname), ''), v_row.reporter_app_user_id)
  into v_reporter_nickname
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id)
      = public.ginit_normalize_app_user_id(v_row.reporter_app_user_id)
  limit 1;

  select
    coalesce(nullif(trim(p.nickname), ''), v_row.reported_app_user_id),
    jsonb_build_object(
      'id', p.id,
      'app_user_id', p.app_user_id,
      'nickname', p.nickname,
      'g_trust', p.g_trust,
      'penalty_count', p.penalty_count,
      'is_restricted', p.is_restricted,
      'is_suspended', coalesce(p.is_suspended, false),
      'is_withdrawn', coalesce(p.is_withdrawn, false)
    )
  into v_reported_nickname, v_reported_profile
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id)
      = public.ginit_normalize_app_user_id(v_row.reported_app_user_id)
  limit 1;

  return to_jsonb(v_row) || jsonb_build_object(
    'reporter_nickname', coalesce(v_reporter_nickname, v_row.reporter_app_user_id),
    'reported_nickname', coalesce(v_reported_nickname, v_row.reported_app_user_id),
    'reported_profile', coalesce(v_reported_profile, '{}'::jsonb),
    'reason_label_ko', public.user_report_reason_label_ko(v_row.reason_code)
  );
end;
$$;

revoke all on function public.admin_get_user_report(uuid) from public;
grant execute on function public.admin_get_user_report(uuid) to authenticated;

notify pgrst, 'reload schema';
