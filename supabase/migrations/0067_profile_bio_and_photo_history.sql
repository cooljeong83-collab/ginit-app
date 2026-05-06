-- profiles.bio(소개) + 프로필 사진 이력 테이블/트리거 + 조회 RPC
-- - bio: 빈 문자열은 null로 정규화, json null은 명시적 삭제
-- - photo history: profiles.photo_url 변경 시 자동 적재

alter table public.profiles
  add column if not exists bio text;

comment on column public.profiles.bio is '한 줄 소개. null이면 미입력.';

-- upsert_profile_payload: bio 반영(기존 0055 로직 유지 + bio만 추가)
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

-- 프로필 사진 이력
create table if not exists public.profile_photo_history (
  id uuid primary key default gen_random_uuid(),
  app_user_id text not null,
  photo_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_photo_history_app_user_id_created_at_idx
  on public.profile_photo_history (app_user_id, created_at desc);

comment on table public.profile_photo_history is '프로필 사진 변경 이력(최근순 그리드 표시용).';

create or replace function public._capture_profile_photo_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.photo_url is distinct from old.photo_url and new.photo_url is not null then
    insert into public.profile_photo_history (app_user_id, photo_url)
    values (new.app_user_id, new.photo_url);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_capture_photo_history on public.profiles;
create trigger profiles_capture_photo_history
after update of photo_url on public.profiles
for each row
execute function public._capture_profile_photo_history();

-- 기존 프로필 사진 1회 백필(있으면 그리드가 바로 비지 않게)
insert into public.profile_photo_history (app_user_id, photo_url, created_at)
select p.app_user_id, p.photo_url, coalesce(p.updated_at, p.created_at, now())
from public.profiles p
where p.photo_url is not null
  and not exists (
    select 1
    from public.profile_photo_history h
    where h.app_user_id = p.app_user_id and h.photo_url = p.photo_url
  );

-- 조회 RPC: 최근 사진 히스토리
create or replace function public.list_profile_photo_history(p_app_user_id text, p_limit int default 30)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    jsonb_agg(to_jsonb(t) order by t.created_at desc),
    '[]'::jsonb
  )
  from (
    select photo_url, created_at
    from public.profile_photo_history
    where app_user_id = nullif(trim(p_app_user_id), '')
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 30), 60))
  ) t;
$$;

revoke all on function public.list_profile_photo_history(text, int) from public;
grant execute on function public.list_profile_photo_history(text, int) to anon, authenticated;

notify pgrst, 'reload schema';

