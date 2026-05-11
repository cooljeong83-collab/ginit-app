-- 탈퇴 후 재가입 대기 정책.
-- account.withdraw_rejoin_wait_days: 0이면 즉시 재가입, 1이면 탈퇴 후 1일 뒤 재가입 가능.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'account',
  'withdraw_rejoin_wait_days',
  '0'::jsonb,
  true,
  '탈퇴 후 재가입 가능 대기 기간(일). 0이면 즉시 재가입 가능, 1이면 withdrawn_at 기준 1일 후 가능.'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

create or replace function public.can_reactivate_withdrawn_profile(p_app_user_id text)
returns table(
  can_reactivate boolean,
  wait_days int,
  available_at timestamptz,
  remaining_seconds int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_withdrawn boolean;
  v_withdrawn_at timestamptz;
  v_wait_days int;
  v_available_at timestamptz;
  v_remaining int;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  select coalesce(p.is_withdrawn, false), p.withdrawn_at
  into v_withdrawn, v_withdrawn_at
  from public.profiles p
  where p.app_user_id = trim(p_app_user_id)
  limit 1;

  if not found or coalesce(v_withdrawn, false) = false then
    return query select true, 0, null::timestamptz, 0;
    return;
  end if;

  v_wait_days := greatest(
    0,
    floor(public.get_policy_numeric('account', 'withdraw_rejoin_wait_days', 0::numeric))::int
  );

  if v_wait_days = 0 or v_withdrawn_at is null then
    return query select true, v_wait_days, null::timestamptz, 0;
    return;
  end if;

  v_available_at := v_withdrawn_at + (v_wait_days * interval '1 day');
  v_remaining := greatest(0, ceil(extract(epoch from (v_available_at - now())))::int);

  return query select now() >= v_available_at, v_wait_days, v_available_at, v_remaining;
end;
$$;

revoke all on function public.can_reactivate_withdrawn_profile(text) from public;
grant execute on function public.can_reactivate_withdrawn_profile(text) to anon, authenticated, service_role;

create or replace function public.assert_withdrawn_profile_can_reactivate(p_app_user_id text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_can boolean;
  v_days int;
  v_available_at timestamptz;
  v_remaining int;
begin
  select can_reactivate, wait_days, available_at, remaining_seconds
  into v_can, v_days, v_available_at, v_remaining
  from public.can_reactivate_withdrawn_profile(p_app_user_id);

  if coalesce(v_can, false) = false then
    raise exception '탈퇴 후 %일 뒤 재가입할 수 있어요.', v_days
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'policy_group', 'account',
              'policy_key', 'withdraw_rejoin_wait_days',
              'wait_days', v_days,
              'available_at', v_available_at,
              'remaining_seconds', v_remaining
            )::text;
  end if;
end;
$$;

revoke all on function public.assert_withdrawn_profile_can_reactivate(text) from public;
grant execute on function public.assert_withdrawn_profile_can_reactivate(text) to anon, authenticated, service_role;

create or replace function public.reactivate_withdrawn_profile_for_signup(p_app_user_id text, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields jsonb;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  perform public.assert_withdrawn_profile_can_reactivate(p_app_user_id);

  v_fields :=
    coalesce(p_fields, '{}'::jsonb)
    || jsonb_build_object(
      'is_withdrawn', false,
      'withdrawn_at', null
    );

  perform public.upsert_profile_payload(p_app_user_id, v_fields);
end;
$$;

revoke all on function public.reactivate_withdrawn_profile_for_signup(text, jsonb) from public;
grant execute on function public.reactivate_withdrawn_profile_for_signup(text, jsonb) to anon, authenticated, service_role;

create or replace function public.upsert_profile_payload(p_app_user_id text, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_withdrawn boolean;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  select coalesce(p.is_withdrawn, false)
  into v_was_withdrawn
  from public.profiles p
  where p.app_user_id = trim(p_app_user_id)
  limit 1;

  if coalesce(v_was_withdrawn, false)
     and p_fields ? 'is_withdrawn'
     and coalesce((p_fields->>'is_withdrawn')::boolean, true) = false
  then
    perform public.assert_withdrawn_profile_can_reactivate(p_app_user_id);
  end if;

  perform public.ensure_profile_minimal(p_app_user_id);

  update public.profiles p
  set
    updated_at = now(),
    nickname = case when p_fields ? 'nickname' then coalesce(nullif(trim(p_fields->>'nickname'), ''), p.nickname) else p.nickname end,
    photo_url = case when p_fields ? 'photo_url' then nullif(trim(p_fields->>'photo_url'), '') else p.photo_url end,
    phone = case when p_fields ? 'phone' then nullif(trim(p_fields->>'phone'), '') else p.phone end,
    phone_verified_at = case when p_fields ? 'phone_verified_at' then (p_fields->>'phone_verified_at')::timestamptz else p.phone_verified_at end,
    email = case when p_fields ? 'email' then nullif(trim(p_fields->>'email'), '') else p.email end,
    display_name = case when p_fields ? 'display_name' then nullif(trim(p_fields->>'display_name'), '') else p.display_name end,
    bio = case
      when not (p_fields ? 'bio') then p.bio
      when jsonb_typeof(p_fields->'bio') = 'null' then null
      else nullif(trim(coalesce(p_fields->>'bio', '')), '')
    end,
    terms_agreed_at = case when p_fields ? 'terms_agreed_at' then (p_fields->>'terms_agreed_at')::timestamptz else p.terms_agreed_at end,
    gender = case when p_fields ? 'gender' then nullif(trim(p_fields->>'gender'), '') else p.gender end,
    age_band = case when p_fields ? 'age_band' then nullif(trim(p_fields->>'age_band'), '') else p.age_band end,
    birth_year = case when p_fields ? 'birth_year' then (p_fields->>'birth_year')::int else p.birth_year end,
    birth_month = case when p_fields ? 'birth_month' then (p_fields->>'birth_month')::int else p.birth_month end,
    birth_day = case when p_fields ? 'birth_day' then (p_fields->>'birth_day')::int else p.birth_day end,
    g_level = case when p_fields ? 'g_level' then (p_fields->>'g_level')::int else p.g_level end,
    g_xp = case when p_fields ? 'g_xp' then (p_fields->>'g_xp')::bigint else p.g_xp end,
    g_trust = case when p_fields ? 'g_trust' then (p_fields->>'g_trust')::int else p.g_trust end,
    g_dna = case when p_fields ? 'g_dna' then coalesce(nullif(trim(p_fields->>'g_dna'), ''), p.g_dna) else p.g_dna end,
    meeting_count = case when p_fields ? 'meeting_count' then (p_fields->>'meeting_count')::int else p.meeting_count end,
    ranking_points = case when p_fields ? 'ranking_points' then (p_fields->>'ranking_points')::int else p.ranking_points end,
    is_withdrawn = case when p_fields ? 'is_withdrawn' then (p_fields->>'is_withdrawn')::boolean else p.is_withdrawn end,
    withdrawn_at = case when p_fields ? 'withdrawn_at' then (p_fields->>'withdrawn_at')::timestamptz else p.withdrawn_at end,
    signup_provider = case when p_fields ? 'signup_provider' then nullif(trim(p_fields->>'signup_provider'), '') else p.signup_provider end,
    fcm_token = case
      when not (p_fields ? 'fcm_token') then p.fcm_token
      when jsonb_typeof(p_fields->'fcm_token') = 'null' then null
      when length(trim(coalesce(p_fields->>'fcm_token', ''))) > 0 then trim(p_fields->>'fcm_token')
      else p.fcm_token
    end,
    fcm_platform = case
      when not (p_fields ? 'fcm_platform') then p.fcm_platform
      when jsonb_typeof(p_fields->'fcm_platform') = 'null' then null
      when trim(coalesce(p_fields->>'fcm_platform', '')) = 'ios' then 'ios'
      when trim(coalesce(p_fields->>'fcm_platform', '')) = 'android' then 'android'
      else p.fcm_platform
    end,
    metadata = case
      when p_fields ? 'metadata' then coalesce((p_fields->'metadata')::jsonb, '{}'::jsonb)
      when p_fields ? 'metadata_patch' then coalesce(p.metadata, '{}'::jsonb) || coalesce((p_fields->'metadata_patch')::jsonb, '{}'::jsonb)
      else coalesce(p.metadata, '{}'::jsonb)
    end
  where p.app_user_id = trim(p_app_user_id);
end;
$$;

revoke all on function public.upsert_profile_payload(text, jsonb) from public;
grant execute on function public.upsert_profile_payload(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
