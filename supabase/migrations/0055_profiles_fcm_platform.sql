-- FCM 수신 OS(ios/android). Edge `fcm-push-send`에서 Android는 data-only로 보내
-- 방해금지 등 클라이언트(Notifee) 표시 경로와 맞춥니다. null은 레거시(iOS와 동일하게 notification 페이로드 유지).

alter table public.profiles
  add column if not exists fcm_platform text;

alter table public.profiles
  drop constraint if exists profiles_fcm_platform_chk;

alter table public.profiles
  add constraint profiles_fcm_platform_chk
  check (fcm_platform is null or fcm_platform in ('ios', 'android'));

comment on column public.profiles.fcm_platform is '마지막 FCM 토큰 등록 OS: ios | android. null은 구버전 앱에서 미기록.';

-- upsert_profile_payload: fcm_platform 갱신(잘못된 값은 기존 컬럼 유지)
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
    phone_verified_at = case when p_fields ? 'phone_verified_at' then (p_fields->>'phone_verified_at')::timestamptz else p.phone_verified_at end,
    email = case when p_fields ? 'email' then nullif(trim(p_fields->>'email'), '') else p.email end,
    display_name = case when p_fields ? 'display_name' then nullif(trim(p_fields->>'display_name'), '') else p.display_name end,
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
