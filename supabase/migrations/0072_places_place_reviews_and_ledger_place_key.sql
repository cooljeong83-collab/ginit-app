-- 장소 스냅샷(places), 멤버 장소 리뷰(place_reviews), 집계 뷰, RPC
-- meetings.place_key + ledger_meeting_put_doc 동기화

-- ─── places ───────────────────────────────────────────────────────────────
create table if not exists public.places (
  place_key text primary key,
  place_name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  category text,
  naver_place_link text,
  preferred_photo_media_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_places_touch on public.places;
create trigger trg_places_touch
before update on public.places
for each row execute function public.touch_updated_at();

create index if not exists places_updated_at_idx on public.places (updated_at desc);

-- ─── meetings.place_key (확정 장소 리뷰 조인·표시용) ─────────────────────────
alter table public.meetings add column if not exists place_key text;

-- ─── place_reviews ──────────────────────────────────────────────────────────
create table if not exists public.place_reviews (
  id uuid primary key default gen_random_uuid(),
  place_key text not null references public.places (place_key) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  reviewer_profile_id uuid not null references public.profiles (id) on delete cascade,
  rating numeric(3, 1) not null,
  vibe_tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (place_key, reviewer_profile_id, meeting_id),
  constraint place_reviews_rating_range check (rating >= 0.5 and rating <= 5.0),
  constraint place_reviews_rating_half_step check (
    (rating::numeric * 2) = round(rating::numeric * 2, 0)
  )
);

create index if not exists place_reviews_place_key_idx on public.place_reviews (place_key);
create index if not exists place_reviews_meeting_id_idx on public.place_reviews (meeting_id);

-- ─── 집계 뷰 (온도) ─────────────────────────────────────────────────────────
create or replace view public.view_place_rating_summary as
select
  place_key,
  round(avg(rating)::numeric, 1) as average_rating,
  count(*)::bigint as total_reviews
from public.place_reviews
group by place_key;

-- ─── RLS: 직접 테이블 접근 차단, RPC만 사용 ────────────────────────────────
alter table public.places enable row level security;
alter table public.place_reviews enable row level security;

-- ─── RPC: 장소 스냅샷 upsert ───────────────────────────────────────────────
create or replace function public.upsert_place_snapshot(
  p_place_key text,
  p_place_name text,
  p_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_category text default null,
  p_naver_place_link text default null,
  p_preferred_photo_media_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := nullif(trim(p_place_key), '');
  n text := nullif(trim(p_place_name), '');
begin
  if k is null or n is null then
    raise exception 'place_key and place_name required';
  end if;

  insert into public.places (
    place_key,
    place_name,
    address,
    latitude,
    longitude,
    category,
    naver_place_link,
    preferred_photo_media_url
  )
  values (
    k,
    n,
    nullif(trim(p_address), ''),
    p_latitude,
    p_longitude,
    nullif(trim(p_category), ''),
    nullif(trim(p_naver_place_link), ''),
    nullif(trim(p_preferred_photo_media_url), '')
  )
  on conflict (place_key) do update
  set
    place_name = excluded.place_name,
    address = coalesce(excluded.address, public.places.address),
    latitude = coalesce(excluded.latitude, public.places.latitude),
    longitude = coalesce(excluded.longitude, public.places.longitude),
    category = coalesce(excluded.category, public.places.category),
    naver_place_link = coalesce(excluded.naver_place_link, public.places.naver_place_link),
    preferred_photo_media_url = coalesce(
      excluded.preferred_photo_media_url,
      public.places.preferred_photo_media_url
    ),
    updated_at = now();
end;
$$;

revoke all on function public.upsert_place_snapshot(
  text, text, text, double precision, double precision, text, text, text
) from public;
grant execute on function public.upsert_place_snapshot(
  text, text, text, double precision, double precision, text, text, text
) to anon, authenticated;

-- ─── RPC: 평균 평점 조회 ───────────────────────────────────────────────────
create or replace function public.get_place_rating_summary(p_place_key text)
returns table (
  average_rating numeric,
  total_reviews bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  k text := nullif(trim(p_place_key), '');
begin
  if k is null then
    return query select 0.0::numeric, 0::bigint;
    return;
  end if;
  return query
  select
    coalesce(round(avg(pr.rating)::numeric, 1), 0.0) as average_rating,
    count(*)::bigint as total_reviews
  from public.place_reviews pr
  where pr.place_key = k;
end;
$$;

revoke all on function public.get_place_rating_summary(text) from public;
grant execute on function public.get_place_rating_summary(text) to anon, authenticated;

-- ─── RPC: 내 리뷰 upsert (모임 참여자만) ───────────────────────────────────
create or replace function public.upsert_my_place_review(
  p_app_user_id text,
  p_place_key text,
  p_meeting_id uuid,
  p_rating numeric,
  p_vibe_tags text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  k text := nullif(trim(p_place_key), '');
  uid text := nullif(trim(p_app_user_id), '');
  r numeric := p_rating::numeric;
  tags text[] := coalesce(p_vibe_tags, '{}'::text[]);
begin
  if uid is null or k is null or p_meeting_id is null then
    raise exception 'app_user_id, place_key, meeting_id required';
  end if;

  if r < 0.5 or r > 5.0 or (r * 2) <> round(r * 2, 0) then
    raise exception 'rating must be 0.5..5.0 in 0.5 steps';
  end if;

  select id into v_profile
  from public.profiles
  where app_user_id = uid
  limit 1;

  if v_profile is null then
    raise exception 'profile not found';
  end if;

  if not exists (
    select 1
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.profile_id = v_profile
  ) then
    raise exception 'not a meeting participant';
  end if;

  if not exists (select 1 from public.places pl where pl.place_key = k) then
    raise exception 'place not registered';
  end if;

  insert into public.place_reviews (
    place_key,
    meeting_id,
    reviewer_profile_id,
    rating,
    vibe_tags
  )
  values (k, p_meeting_id, v_profile, r, tags)
  on conflict (place_key, reviewer_profile_id, meeting_id) do update
  set
    rating = excluded.rating,
    vibe_tags = excluded.vibe_tags,
    created_at = now();
end;
$$;

revoke all on function public.upsert_my_place_review(text, text, uuid, numeric, text[]) from public;
grant execute on function public.upsert_my_place_review(text, text, uuid, numeric, text[]) to anon, authenticated;

-- ─── ledger_meeting_put_doc: place_key 동기화 ───────────────────────────────
create or replace function public.ledger_meeting_put_doc(p_meeting_id text, p_doc jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := p_meeting_id::uuid;
  v_title text := coalesce(nullif(trim(p_doc->>'title'), ''), '제목 없음');
  v_desc text := coalesce(nullif(trim(p_doc->>'description'), ''), '');
  v_cap int := greatest(1, coalesce((p_doc->>'capacity')::int, 1));
  v_min int := case when p_doc ? 'minParticipants' and p_doc->>'minParticipants' is not null then (p_doc->>'minParticipants')::int else null end;
  v_cat_id text := coalesce(nullif(trim(p_doc->>'categoryId'), ''), '');
  v_cat_lbl text := coalesce(nullif(trim(p_doc->>'categoryLabel'), ''), '');
  v_pub boolean := coalesce((p_doc->>'isPublic')::boolean, false);
  v_img text := nullif(trim(p_doc->>'imageUrl'), '');
  v_place text := coalesce(nullif(trim(p_doc->>'placeName'), ''), '');
  v_addr text := coalesce(nullif(trim(p_doc->>'address'), ''), '');
  v_lat double precision := coalesce((p_doc->>'latitude')::double precision, 0);
  v_lng double precision := coalesce((p_doc->>'longitude')::double precision, 0);
  v_sd text := coalesce(nullif(trim(p_doc->>'scheduleDate'), ''), '');
  v_st text := coalesce(nullif(trim(p_doc->>'scheduleTime'), ''), '');
  v_sched timestamptz := case
    when p_doc ? 'scheduledAt' and p_doc->>'scheduledAt' is not null then (p_doc->>'scheduledAt')::timestamptz
    else null
  end;
  v_conf boolean := coalesce((p_doc->>'scheduleConfirmed')::boolean, false);
  v_cd text := nullif(trim(p_doc->>'confirmedDateChipId'), '');
  v_cp text := nullif(trim(p_doc->>'confirmedPlaceChipId'), '');
  v_cm text := nullif(trim(p_doc->>'confirmedMovieChipId'), '');
begin
  update public.meetings m
  set
    extra_data = jsonb_set(coalesce(m.extra_data, '{}'::jsonb), '{fs}', p_doc, true),
    title = v_title,
    description = nullif(v_desc, ''),
    capacity = v_cap,
    min_participants = v_min,
    category_id = nullif(v_cat_id, ''),
    category_label = nullif(v_cat_lbl, ''),
    is_public = v_pub,
    image_url = nullif(v_img, ''),
    place_name = nullif(v_place, ''),
    address = nullif(v_addr, ''),
    latitude = v_lat,
    longitude = v_lng,
    schedule_date = nullif(v_sd, ''),
    schedule_time = nullif(v_st, ''),
    scheduled_at = v_sched,
    schedule_confirmed = v_conf,
    confirmed_date_chip_id = v_cd,
    confirmed_place_chip_id = v_cp,
    confirmed_movie_chip_id = v_cm,
    place_key = case
      when not (p_doc ? 'placeKey') then m.place_key
      when jsonb_typeof(p_doc->'placeKey') = 'null' then null
      else nullif(trim(p_doc->>'placeKey'), '')
    end,
    updated_at = now()
  where m.id = v;
end;
$$;

revoke all on function public.ledger_meeting_put_doc(text, jsonb) from public;
grant execute on function public.ledger_meeting_put_doc(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
