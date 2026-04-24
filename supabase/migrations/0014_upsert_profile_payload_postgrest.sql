  -- 탈퇴·프로필 수정용 `upsert_profile_payload` — PostgREST 스키마 캐시에 안 잡힐 때 재적용(0008과 동일 본문).

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

  notify pgrst, 'reload schema';
