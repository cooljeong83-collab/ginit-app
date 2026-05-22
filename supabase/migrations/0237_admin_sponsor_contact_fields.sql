-- Admin: sponsor contact profile fields (phone, address, memo, age group)

alter table public.sponsors
  add column if not exists contact_phone text,
  add column if not exists contact_address text,
  add column if not exists memo text,
  add column if not exists age_group text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.sponsors
  drop constraint if exists sponsors_age_group_check;

alter table public.sponsors
  add constraint sponsors_age_group_check check (
    age_group is null
    or age_group in ('20s', '30s', '40s', '50s', '60s', '70plus', 'unknown')
  );

create or replace function public.admin_list_sponsors(p_limit int default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'contact_phone', s.contact_phone,
          'contact_address', s.contact_address,
          'age_group', s.age_group,
          'created_at', s.created_at
        )
        order by s.created_at desc
      )
      from (
        select *
        from public.sponsors
        order by created_at desc
        limit least(p_limit, 50)
      ) s
    ),
    '[]'::jsonb
  );
end;
$$;

drop function if exists public.admin_upsert_sponsor(uuid, text, text, text);

create or replace function public.admin_upsert_sponsor(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_name text := nullif(trim(coalesce(p_payload->>'name', '')), '');
  v_contact_email text := nullif(trim(coalesce(p_payload->>'contact_email', '')), '');
  v_contact_phone text := nullif(trim(coalesce(p_payload->>'contact_phone', '')), '');
  v_contact_address text := nullif(trim(coalesce(p_payload->>'contact_address', '')), '');
  v_memo text := nullif(trim(coalesce(p_payload->>'memo', '')), '');
  v_age_group text := nullif(trim(coalesce(p_payload->>'age_group', '')), '');
  v_logo_url text := nullif(trim(coalesce(p_payload->>'logo_url', '')), '');
begin
  perform public.assert_current_user_admin();

  if v_name is null then
    raise exception 'sponsor_name_required';
  end if;

  if v_age_group is not null
    and v_age_group not in ('20s', '30s', '40s', '50s', '60s', '70plus', 'unknown')
  then
    raise exception 'invalid_sponsor_age_group';
  end if;

  if v_id is null then
    insert into public.sponsors (
      name,
      contact_email,
      contact_phone,
      contact_address,
      memo,
      age_group,
      logo_url
    )
    values (
      v_name,
      v_contact_email,
      v_contact_phone,
      v_contact_address,
      v_memo,
      v_age_group,
      v_logo_url
    )
    returning id into v_id;
  else
    update public.sponsors s
    set
      name = v_name,
      contact_email = v_contact_email,
      contact_phone = v_contact_phone,
      contact_address = v_contact_address,
      memo = v_memo,
      age_group = v_age_group,
      logo_url = coalesce(v_logo_url, s.logo_url),
      updated_at = now()
    where s.id = v_id;

    if not found then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_sponsor(jsonb) from public;
grant execute on function public.admin_upsert_sponsor(jsonb) to authenticated;
