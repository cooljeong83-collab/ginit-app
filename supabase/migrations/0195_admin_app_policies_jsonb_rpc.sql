-- Admin app_policies: v2 schema (policy_group + policy_key + jsonb policy_value)

drop function if exists public.admin_upsert_app_policy(text, numeric, text);

create or replace function public.admin_list_app_policies()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', ap.id,
        'policy_group', ap.policy_group,
        'policy_key', ap.policy_key,
        'policy_value', ap.policy_value,
        'is_active', ap.is_active,
        'description', ap.description,
        'updated_at', ap.updated_at
      )
      order by ap.policy_group, ap.policy_key
    )
    from public.app_policies ap
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_app_policies() from public;
grant execute on function public.admin_list_app_policies() to authenticated;

create or replace function public.admin_upsert_app_policy(
  p_group text,
  p_key text,
  p_value jsonb,
  p_is_active boolean default true,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  if coalesce(trim(p_group), '') = '' or coalesce(trim(p_key), '') = '' then
    raise exception 'policy_group and policy_key required';
  end if;
  if p_value is null then
    raise exception 'policy_value required';
  end if;

  insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
  values (trim(p_group), trim(p_key), p_value, coalesce(p_is_active, true), p_description)
  on conflict (policy_group, policy_key) do update
  set
    policy_value = excluded.policy_value,
    is_active = excluded.is_active,
    description = coalesce(excluded.description, public.app_policies.description),
    updated_at = now();
end;
$$;

revoke all on function public.admin_upsert_app_policy(text, text, jsonb, boolean, text) from public;
grant execute on function public.admin_upsert_app_policy(text, text, jsonb, boolean, text) to authenticated;

notify pgrst, 'reload schema';
