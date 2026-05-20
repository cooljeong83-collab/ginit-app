-- Approve: keep user_reports row + evidence (audit). Dismiss only: purge Storage + delete row.

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
  v_status text := lower(trim(coalesce(p_status, '')));
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
    perform public.apply_trust_penalty_report_approved(
      v_row.reported_app_user_id,
      'admin_report:' || p_report_id::text
    );
    update public.user_reports
    set
      status = 'approved',
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

revoke all on function public.admin_resolve_user_report(uuid, text, text) from public;
grant execute on function public.admin_resolve_user_report(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
