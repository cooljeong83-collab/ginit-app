-- On approve/dismiss: delete evidence Storage objects and remove user_reports row.

create or replace function private.delete_user_report_evidence_url(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(trim(p_url), '');
  v_clean text;
begin
  if v_url is null then
    return;
  end if;

  if v_url !~* '/storage/v1/object/public/user_report_evidence/' then
    return;
  end if;

  v_clean := regexp_replace(
    v_url,
    '^.*\/storage\/v1\/object\/public\/user_report_evidence\/',
    '',
    'i'
  );
  v_clean := trim(both '/' from split_part(split_part(v_clean, '?', 1), '#', 1));

  if v_clean is null or v_clean = '' then
    return;
  end if;
  if v_clean ~ '\.\.' then
    raise exception 'invalid object path';
  end if;
  if left(v_clean, 8) is distinct from 'reports/' then
    raise exception 'forbidden';
  end if;

  delete from storage.objects
  where bucket_id = 'user_report_evidence'
    and name = v_clean;
end;
$$;

revoke all on function private.delete_user_report_evidence_url(text) from public;

create or replace function private.purge_user_report_evidence(p_evidence jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_urls jsonb;
  v_i int;
  v_url text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    return;
  end if;
  v_urls := p_evidence->'image_urls';
  if v_urls is null or jsonb_typeof(v_urls) <> 'array' then
    return;
  end if;
  for v_i in 0 .. (jsonb_array_length(v_urls) - 1) loop
    v_url := trim(both '"' from (v_urls->>v_i));
    if coalesce(v_url, '') <> '' then
      perform private.delete_user_report_evidence_url(v_url);
    end if;
  end loop;
end;
$$;

revoke all on function private.purge_user_report_evidence(jsonb) from public;

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

  if v_status in ('approved', 'dismissed') then
    if v_status = 'approved' then
      perform public.apply_trust_penalty_report_approved(
        v_row.reported_app_user_id,
        'admin_report:' || p_report_id::text
      );
    end if;
    perform private.purge_user_report_evidence(v_row.evidence);
    delete from public.user_reports where id = p_report_id;
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
