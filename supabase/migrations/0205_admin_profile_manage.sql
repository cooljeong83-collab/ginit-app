-- Admin: profile edit + moderation (suspend / restrict / withdraw)

-- ---------------------------------------------------------------------------
-- admin_update_profile — safe field updates (no direct client metric bypass elsewhere)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_profile(
  p_profile_id uuid,
  p_fields jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
  v_admin_id uuid;
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_metric_touch boolean := false;
begin
  perform public.assert_current_user_admin();
  select id into v_admin_id from public.profiles where auth_user_id = auth.uid() limit 1;

  select * into v_row from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  if coalesce(v_row.is_withdrawn, false) then
    raise exception 'profile_withdrawn';
  end if;

  v_metric_touch := v_fields ?| array[
    'g_trust', 'g_level', 'g_xp', 'penalty_count', 'is_restricted', 'meeting_count', 'ranking_points'
  ];

  if v_metric_touch then
    perform set_config('ginit.skip_profile_metric_guard', '1', true);
  end if;

  update public.profiles p
  set
    updated_at = now(),
    nickname = case
      when v_fields ? 'nickname' then coalesce(nullif(trim(v_fields->>'nickname'), ''), p.nickname)
      else p.nickname
    end,
    email = case when v_fields ? 'email' then nullif(trim(v_fields->>'email'), '') else p.email end,
    display_name = case
      when v_fields ? 'display_name' then nullif(trim(v_fields->>'display_name'), '')
      else p.display_name
    end,
    bio = case
      when not (v_fields ? 'bio') then p.bio
      when jsonb_typeof(v_fields->'bio') = 'null' then null
      else nullif(trim(coalesce(v_fields->>'bio', '')), '')
    end,
    phone = case when v_fields ? 'phone' then nullif(trim(v_fields->>'phone'), '') else p.phone end,
    gender = case when v_fields ? 'gender' then nullif(trim(v_fields->>'gender'), '') else p.gender end,
    age_band = case
      when v_fields ? 'age_band' then nullif(trim(v_fields->>'age_band'), '')
      else p.age_band
    end,
    birth_year = case when v_fields ? 'birth_year' then (v_fields->>'birth_year')::int else p.birth_year end,
    birth_month = case when v_fields ? 'birth_month' then (v_fields->>'birth_month')::int else p.birth_month end,
    birth_day = case when v_fields ? 'birth_day' then (v_fields->>'birth_day')::int else p.birth_day end,
    g_trust = case when v_fields ? 'g_trust' then greatest(0, least(100, (v_fields->>'g_trust')::int)) else p.g_trust end,
    g_level = case when v_fields ? 'g_level' then greatest(1, (v_fields->>'g_level')::int) else p.g_level end,
    g_xp = case when v_fields ? 'g_xp' then greatest(0, (v_fields->>'g_xp')::bigint) else p.g_xp end,
    penalty_count = case
      when v_fields ? 'penalty_count' then greatest(0, (v_fields->>'penalty_count')::int)
      else p.penalty_count
    end,
    is_restricted = case
      when v_fields ? 'is_restricted' then coalesce((v_fields->>'is_restricted')::boolean, p.is_restricted)
      else p.is_restricted
    end,
    meeting_count = case
      when v_fields ? 'meeting_count' then greatest(0, (v_fields->>'meeting_count')::int)
      else p.meeting_count
    end,
    ranking_points = case
      when v_fields ? 'ranking_points' then (v_fields->>'ranking_points')::int
      else p.ranking_points
    end,
    admin = case
      when v_fields ? 'admin' then
        case when lower(trim(coalesce(v_fields->>'admin', ''))) in ('y', 'n') then lower(trim(v_fields->>'admin')) else p.admin end
      else p.admin
    end
  where p.id = p_profile_id
  returning * into v_row;

  insert into public.admin_audit_log (actor_profile_id, action, entity_type, entity_id, meta)
  values (
    v_admin_id,
    'profile.update',
    'profile',
    p_profile_id::text,
    jsonb_build_object('fields', v_fields)
  );

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_update_profile(uuid, jsonb) from public;
grant execute on function public.admin_update_profile(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_moderate_profile — suspend / restrict / withdraw
-- ---------------------------------------------------------------------------
create or replace function public.admin_moderate_profile(
  p_profile_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
  v_admin_id uuid;
  v_action text := lower(trim(coalesce(p_action, '')));
begin
  perform public.assert_current_user_admin();
  select id into v_admin_id from public.profiles where auth_user_id = auth.uid() limit 1;

  select * into v_row from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  case v_action
    when 'suspend' then
      if coalesce(v_row.is_withdrawn, false) then
        raise exception 'profile_withdrawn';
      end if;
      update public.profiles
      set
        is_suspended = true,
        suspended_at = now(),
        suspended_by_profile_id = v_admin_id,
        updated_at = now()
      where id = p_profile_id
      returning * into v_row;

    when 'unsuspend' then
      update public.profiles
      set
        is_suspended = false,
        suspended_at = null,
        suspended_by_profile_id = null,
        updated_at = now()
      where id = p_profile_id
      returning * into v_row;

    when 'restrict' then
      if coalesce(v_row.is_withdrawn, false) then
        raise exception 'profile_withdrawn';
      end if;
      perform set_config('ginit.skip_profile_metric_guard', '1', true);
      update public.profiles
      set is_restricted = true, updated_at = now()
      where id = p_profile_id
      returning * into v_row;

    when 'unrestrict' then
      perform set_config('ginit.skip_profile_metric_guard', '1', true);
      update public.profiles
      set is_restricted = false, updated_at = now()
      where id = p_profile_id
      returning * into v_row;

    when 'withdraw' then
      if coalesce(v_row.is_withdrawn, false) then
        raise exception 'already_withdrawn';
      end if;
      perform public.withdraw_anonymize_profile(v_row.app_user_id);
      select * into v_row from public.profiles where id = p_profile_id;

    else
      raise exception 'invalid_action';
  end case;

  insert into public.admin_audit_log (actor_profile_id, action, entity_type, entity_id, meta)
  values (
    v_admin_id,
    'profile.' || v_action,
    'profile',
    p_profile_id::text,
    jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), ''))
  );

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_moderate_profile(uuid, text, text) from public;
grant execute on function public.admin_moderate_profile(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
