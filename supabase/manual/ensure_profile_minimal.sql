-- =============================================================================
-- Supabase Dashboard → SQL Editor 에서 전체를 붙여넣고 Run 하세요.
-- ensure_profile_minimal 은 get_policy_numeric('trust','default_score') 가 필요합니다(0019+).
-- 오류 예:
--   could not find the function public.ensure_profile_minimal(p_app_user_id) in the schema cache
--   could not find the function public.upsert_profile_payload(p_app_user_id, p_fields) in the schema cache
--   could not find the function public.get_profile_public_by_app_user_id(p_app_user_id) in the schema cache
--   column p.signup_provider does not exist (탈퇴·upsert 시) → 아래 ALTER가 반드시 필요합니다.
-- =============================================================================

alter table public.profiles
  add column if not exists signup_provider text;

create or replace function public.ensure_profile_minimal(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := '모임친구' || substr(md5(random()::text), 1, 6);
  v_initial_trust int;
  v_raw numeric;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  v_raw := public.get_policy_numeric('trust', 'default_score', 100::numeric);
  v_initial_trust := least(100, greatest(0, round(coalesce(v_raw, 100::numeric))::int));

  insert into public.profiles (app_user_id, nickname, g_trust)
  values (trim(p_app_user_id), v_nick, v_initial_trust)
  on conflict (app_user_id) do nothing;
end;
$$;

revoke all on function public.ensure_profile_minimal(text) from public;
grant execute on function public.ensure_profile_minimal(text) to anon, authenticated;

create or replace function public.upsert_profile_payload(p_app_user_id text, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  perform public.ensure_profile_minimal(p_app_user_id);

  update public.profiles p
  set
    updated_at = now(),
    nickname = case when p_fields ? 'nickname' then coalesce(nullif(trim(p_fields->>'nickname'), ''), p.nickname) else p.nickname end,
    photo_url = case when p_fields ? 'photo_url' then nullif(trim(p_fields->>'photo_url'), '') else p.photo_url end,
    phone = case when p_fields ? 'phone' then nullif(trim(p_fields->>'phone'), '') else p.phone end,
    phone_verified_at = case
      when p_fields ? 'phone_verified_at' and p_fields->>'phone_verified_at' is not null
      then (p_fields->>'phone_verified_at')::timestamptz
      else p.phone_verified_at
    end,
    email = case when p_fields ? 'email' then nullif(trim(p_fields->>'email'), '') else p.email end,
    display_name = case when p_fields ? 'display_name' then nullif(trim(p_fields->>'display_name'), '') else p.display_name end,
    terms_agreed_at = case
      when p_fields ? 'terms_agreed_at' and p_fields->>'terms_agreed_at' is not null
      then (p_fields->>'terms_agreed_at')::timestamptz
      else p.terms_agreed_at
    end,
    gender = case when p_fields ? 'gender' then nullif(trim(p_fields->>'gender'), '') else p.gender end,
    age_band = case when p_fields ? 'age_band' then nullif(trim(p_fields->>'age_band'), '') else p.age_band end,
    birth_year = case when p_fields ? 'birth_year' and p_fields->>'birth_year' is not null then (p_fields->>'birth_year')::int else p.birth_year end,
    birth_month = case when p_fields ? 'birth_month' and p_fields->>'birth_month' is not null then (p_fields->>'birth_month')::int else p.birth_month end,
    birth_day = case when p_fields ? 'birth_day' and p_fields->>'birth_day' is not null then (p_fields->>'birth_day')::int else p.birth_day end,
    g_level = case when p_fields ? 'g_level' and p_fields->>'g_level' is not null then (p_fields->>'g_level')::int else p.g_level end,
    g_xp = case when p_fields ? 'g_xp' and p_fields->>'g_xp' is not null then (p_fields->>'g_xp')::bigint else p.g_xp end,
    g_trust = case when p_fields ? 'g_trust' and p_fields->>'g_trust' is not null then (p_fields->>'g_trust')::int else p.g_trust end,
    g_dna = case when p_fields ? 'g_dna' then coalesce(nullif(trim(p_fields->>'g_dna'), ''), p.g_dna) else p.g_dna end,
    meeting_count = case when p_fields ? 'meeting_count' and p_fields->>'meeting_count' is not null then (p_fields->>'meeting_count')::int else p.meeting_count end,
    ranking_points = case when p_fields ? 'ranking_points' and p_fields->>'ranking_points' is not null then (p_fields->>'ranking_points')::int else p.ranking_points end,
    is_withdrawn = case when p_fields ? 'is_withdrawn' then (p_fields->>'is_withdrawn')::boolean else p.is_withdrawn end,
    withdrawn_at = case
      when p_fields ? 'withdrawn_at' and p_fields->>'withdrawn_at' is not null
      then (p_fields->>'withdrawn_at')::timestamptz
      else p.withdrawn_at
    end,
    signup_provider = case when p_fields ? 'signup_provider' then nullif(trim(p_fields->>'signup_provider'), '') else p.signup_provider end
  where p.app_user_id = trim(p_app_user_id);
end;
$$;

revoke all on function public.upsert_profile_payload(text, jsonb) from public;
grant execute on function public.upsert_profile_payload(text, jsonb) to anon, authenticated;

create or replace function public.get_profile_public_by_app_user_id(p_app_user_id text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(p)
  from public.profiles p
  where p.app_user_id = nullif(trim(p_app_user_id), '')
  limit 1;
$$;

revoke all on function public.get_profile_public_by_app_user_id(text) from public;
grant execute on function public.get_profile_public_by_app_user_id(text) to anon, authenticated;

notify pgrst, 'reload schema';

select exists(
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ensure_profile_minimal'
    and pg_get_function_identity_arguments(p.oid) = 'p_app_user_id text'
) as ensure_profile_minimal_ok,
exists(
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'upsert_profile_payload'
    and pg_get_function_identity_arguments(p.oid) = 'p_app_user_id text, p_fields jsonb'
) as upsert_profile_payload_ok,
exists(
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_profile_public_by_app_user_id'
    and pg_get_function_identity_arguments(p.oid) = 'p_app_user_id text'
) as get_profile_public_by_app_user_id_ok;
