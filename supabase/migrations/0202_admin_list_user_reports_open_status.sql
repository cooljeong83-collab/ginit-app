-- admin_list_user_reports: p_status = 'open' → 미처리(pending, reviewing)만

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
      and (
        v_status is null
        or (v_status = 'open' and ur.status in ('pending', 'reviewing'))
        or (v_status is distinct from 'open' and ur.status = v_status)
      )
    order by ur.created_at desc
    limit v_limit + 1
  ) x;
  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_user_reports(text, int, timestamptz) from public;
grant execute on function public.admin_list_user_reports(text, int, timestamptz) to authenticated;

notify pgrst, 'reload schema';
