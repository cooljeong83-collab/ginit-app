-- admin_dashboard_stats calls admin_refresh_daily_rollups (INSERT).
-- STABLE functions run in a read-only transaction → "cannot execute insert in a read-only transaction".

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
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

notify pgrst, 'reload schema';
