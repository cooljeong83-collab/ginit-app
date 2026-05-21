-- Places 마스터(UUID) + meeting_reviews.place_id FK + 온디맨드 집계·조회 RPC

-- ─── 레거시 place_reviews / 0072 places(place_key PK·address) 제거 ─────────
drop table if exists public.place_reviews cascade;
drop table if exists public.places cascade;

-- ─── places 마스터 ─────────────────────────────────────────────────────────
create table public.places (
  id uuid primary key default gen_random_uuid(),
  place_key text not null,
  place_name varchar(255) not null,
  road_address text not null,
  category varchar(100),
  preferred_photo_media_url text,
  naver_place_link text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  average_rating numeric(3, 2) not null default 0.0,
  review_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_place_key_unique unique (place_key),
  constraint places_average_rating_range check (average_rating >= 0 and average_rating <= 5),
  constraint places_review_count_nonneg check (review_count >= 0)
);

create index if not exists places_place_key_idx on public.places (place_key);
create index if not exists places_updated_at_idx on public.places (updated_at desc);

drop trigger if exists trg_places_touch on public.places;
create trigger trg_places_touch
before update on public.places
for each row execute function public.touch_updated_at();

alter table public.places enable row level security;
revoke all on table public.places from public;
revoke all on table public.places from anon;
revoke all on table public.places from authenticated;

-- ─── meeting_reviews.place_id → places.id (UUID FK) ───────────────────────
alter table public.meeting_reviews add column if not exists place_id_uuid uuid;

-- 기존 text place_id를 place_key로 승격해 마스터·FK 백필
insert into public.places (
  place_key,
  place_name,
  road_address,
  category,
  latitude,
  longitude
)
select distinct on (src.place_key)
  src.place_key,
  src.place_name,
  src.road_address,
  src.category,
  src.latitude,
  src.longitude
from (
  select
    nullif(trim(mr.place_id), '') as place_key,
    coalesce(nullif(trim(m.place_name), ''), '장소') as place_name,
    coalesce(nullif(trim(m.address), ''), '') as road_address,
    nullif(trim(m.category_label), '') as category,
    case when m.latitude is not null and m.latitude <> 0 then m.latitude::numeric(10, 7) else null end as latitude,
    case when m.longitude is not null and m.longitude <> 0 then m.longitude::numeric(10, 7) else null end as longitude
  from public.meeting_reviews mr
  inner join public.meetings m on m.id = mr.meeting_id
  where nullif(trim(mr.place_id), '') is not null
) src
where src.place_key is not null
on conflict (place_key) do nothing;

update public.meeting_reviews mr
set place_id_uuid = pl.id
from public.places pl
where pl.place_key = nullif(trim(mr.place_id), '')
  and mr.place_id_uuid is null;

-- FK 대상 없는 행: meeting 기준 최소 마스터 생성
insert into public.places (
  place_key,
  place_name,
  road_address
)
select distinct on (src.place_key)
  src.place_key,
  src.place_name,
  src.road_address
from (
  select
    nullif(trim(mr.place_id), '') as place_key,
    coalesce(nullif(trim(m.place_name), ''), '장소') as place_name,
    coalesce(nullif(trim(m.address), ''), '') as road_address
  from public.meeting_reviews mr
  inner join public.meetings m on m.id = mr.meeting_id
  where mr.place_id_uuid is null
    and nullif(trim(mr.place_id), '') is not null
) src
where src.place_key is not null
on conflict (place_key) do nothing;

update public.meeting_reviews mr
set place_id_uuid = pl.id
from public.places pl
where pl.place_key = nullif(trim(mr.place_id), '')
  and mr.place_id_uuid is null;

-- orphan 제거(마스터 매핑 불가)
delete from public.meeting_reviews where place_id_uuid is null;

alter table public.meeting_reviews drop column if exists place_id;
alter table public.meeting_reviews rename column place_id_uuid to place_id;

alter table public.meeting_reviews
  alter column place_id set not null;

alter table public.meeting_reviews drop constraint if exists meeting_reviews_place_id_fkey;
alter table public.meeting_reviews
  add constraint meeting_reviews_place_id_fkey
  foreign key (place_id) references public.places (id) on delete restrict;

create index if not exists meeting_reviews_place_created_idx
  on public.meeting_reviews (place_id, created_at desc);

-- ─── 집계 갱신(내부) ───────────────────────────────────────────────────────
create or replace function public.refresh_place_rating_stats(p_place_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(3, 2);
  v_cnt int;
begin
  if p_place_id is null then
    return;
  end if;

  select
    coalesce(round(avg(r.rating)::numeric, 2), 0.0),
    count(*)::int
  into v_avg, v_cnt
  from public.meeting_reviews r
  where r.place_id = p_place_id;

  update public.places pl
  set
    average_rating = coalesce(v_avg, 0.0),
    review_count = coalesce(v_cnt, 0),
    updated_at = now()
  where pl.id = p_place_id;
end;
$$;

revoke all on function public.refresh_place_rating_stats(uuid) from public;

-- 초기 집계 동기화
do $$
declare
  pid uuid;
begin
  for pid in select distinct place_id from public.meeting_reviews
  loop
    perform public.refresh_place_rating_stats(pid);
  end loop;
end;
$$;

-- ─── RPC: places 마스터 upsert ─────────────────────────────────────────────
create or replace function public.upsert_place_master(
  p_place_key text,
  p_place_name text,
  p_road_address text,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_category text default null,
  p_naver_place_link text default null,
  p_preferred_photo_media_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := nullif(trim(p_place_key), '');
  v_name text := nullif(trim(p_place_name), '');
  v_addr text := nullif(trim(p_road_address), '');
  v_id uuid;
begin
  if v_key is null or v_name is null or v_addr is null then
    raise exception 'place_key_place_name_road_address_required';
  end if;

  insert into public.places (
    place_key,
    place_name,
    road_address,
    latitude,
    longitude,
    category,
    naver_place_link,
    preferred_photo_media_url
  )
  values (
    v_key,
    left(v_name, 255),
    v_addr,
    case when p_latitude is not null then p_latitude::numeric(10, 7) else null end,
    case when p_longitude is not null then p_longitude::numeric(10, 7) else null end,
    nullif(trim(p_category), ''),
    nullif(trim(p_naver_place_link), ''),
    nullif(trim(p_preferred_photo_media_url), '')
  )
  on conflict (place_key) do update
  set
    place_name = excluded.place_name,
    road_address = excluded.road_address,
    latitude = coalesce(excluded.latitude, public.places.latitude),
    longitude = coalesce(excluded.longitude, public.places.longitude),
    category = coalesce(excluded.category, public.places.category),
    naver_place_link = coalesce(excluded.naver_place_link, public.places.naver_place_link),
    preferred_photo_media_url = coalesce(
      excluded.preferred_photo_media_url,
      public.places.preferred_photo_media_url
    ),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_place_master(
  text, text, text, double precision, double precision, text, text, text
) from public;
grant execute on function public.upsert_place_master(
  text, text, text, double precision, double precision, text, text, text
) to anon, authenticated;

-- ─── RPC: place_key 배치 조회(배지) ────────────────────────────────────────
create or replace function public.get_places_by_keys(p_place_keys text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_keys text[];
begin
  v_keys := (
    select coalesce(array_agg(distinct k), '{}'::text[])
    from (
      select nullif(trim(x), '') as k
      from unnest(coalesce(p_place_keys, '{}'::text[])) as x
    ) t
    where k is not null
  );

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'place_key', pl.place_key,
          'id', pl.id,
          'place_name', pl.place_name,
          'average_rating', pl.average_rating,
          'review_count', pl.review_count,
          'category', pl.category,
          'road_address', pl.road_address,
          'preferred_photo_media_url', pl.preferred_photo_media_url,
          'naver_place_link', pl.naver_place_link,
          'latitude', pl.latitude,
          'longitude', pl.longitude
        )
        order by pl.place_key
      )
      from public.places pl
      where pl.place_key = any (v_keys)
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_places_by_keys(text[]) from public;
grant execute on function public.get_places_by_keys(text[]) to anon, authenticated;

-- ─── RPC: 장소별 후기 타임라인 ─────────────────────────────────────────────
create or replace function public.list_place_reviews_by_place_key(
  p_place_key text,
  p_limit int default 20,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := nullif(trim(p_place_key), '');
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_place_id uuid;
  v_items jsonb;
  v_next timestamptz;
  v_raw_count int;
begin
  if v_key is null then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  select pl.id into v_place_id
  from public.places pl
  where pl.place_key = v_key
  limit 1;

  if v_place_id is null then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      r.id,
      r.rating,
      r.selected_keywords,
      r.comment,
      r.created_at,
      coalesce(nullif(btrim(p.nickname), ''), r.reviewer_app_user_id) as display_name,
      nullif(btrim(p.photo_url), '') as avatar_url,
      r.reviewer_app_user_id as app_user_id
    from public.meeting_reviews r
    left join public.profiles p
      on public.ginit_normalize_app_user_id(p.app_user_id)
       = public.ginit_normalize_app_user_id(r.reviewer_app_user_id)
    where r.place_id = v_place_id
      and (p_cursor is null or r.created_at < p_cursor)
    order by r.created_at desc
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'created_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'created_at') desc nulls last), '[]'::jsonb)
      from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      where ord <= v_limit
    );
  else
    v_next := null;
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.list_place_reviews_by_place_key(text, int, timestamptz) from public;
grant execute on function public.list_place_reviews_by_place_key(text, int, timestamptz) to anon, authenticated;

-- ─── RPC: 모임 장소 후기 upsert (places 온디맨드 + UUID FK) ─────────────────
drop function if exists public.upsert_meeting_place_review(text, text, text, integer, text[], text);

create or replace function public.upsert_meeting_place_review(
  p_meeting_id text,
  p_app_user_id text,
  p_place_id text default null,
  p_rating integer default null,
  p_selected_keywords text[] default '{}'::text[],
  p_comment text default null,
  p_place_key text default null,
  p_place_name text default null,
  p_road_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_category text default null,
  p_naver_place_link text default null,
  p_preferred_photo_media_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_uid text := nullif(trim(coalesce(p_app_user_id, '')), '');
  v_place_uuid uuid;
  v_place_text text := nullif(trim(coalesce(p_place_id, '')), '');
  v_place_key text := nullif(trim(coalesce(p_place_key, '')), '');
  v_keywords text[] := coalesce(p_selected_keywords, '{}'::text[]);
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_allowed text[] := public.meeting_review_allowed_keywords();
  v_bad_kw text;
  v_profile_id uuid;
  v_pol jsonb;
  v_xp int;
  v_trust_delta int;
  v_trust_cap int;
  v_xp_rows int := 0;
  v_inserted boolean := false;
  v_xp_granted int := 0;
  v_trust_granted int := 0;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if v_uid is null then
    raise exception 'app_user_id_required';
  end if;

  begin
    v_mid := p_meeting_id::uuid;
  exception
    when others then
      raise exception 'invalid_meeting_id';
  end;

  if not exists (select 1 from public.meetings m where m.id = v_mid) then
    raise exception 'meeting_not_found';
  end if;

  if not public.meeting_review_is_settled(v_mid) then
    raise exception 'meeting_not_settled';
  end if;

  if not public.meeting_review_is_participant(v_mid, v_uid) then
    raise exception 'not_a_meeting_participant';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  if coalesce(array_length(v_keywords, 1), 0) > 3 then
    raise exception 'too_many_keywords';
  end if;

  select kw into v_bad_kw
  from unnest(v_keywords) as kw
  where not (kw = any (v_allowed))
  limit 1;

  if v_bad_kw is not null then
    raise exception 'invalid_keyword';
  end if;

  -- places 마스터: 스냅샷 우선, 없으면 UUID place_id
  if v_place_key is not null
    and nullif(trim(coalesce(p_place_name, '')), '') is not null
    and nullif(trim(coalesce(p_road_address, '')), '') is not null
  then
    v_place_uuid := public.upsert_place_master(
      v_place_key,
      p_place_name,
      p_road_address,
      p_latitude,
      p_longitude,
      p_category,
      p_naver_place_link,
      p_preferred_photo_media_url
    );
  elsif v_place_text is not null then
    begin
      v_place_uuid := v_place_text::uuid;
    exception
      when others then
        raise exception 'place_id_required';
    end;

    if not exists (select 1 from public.places pl where pl.id = v_place_uuid) then
      raise exception 'place_not_found';
    end if;
  else
    raise exception 'place_id_required';
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id) = public.ginit_normalize_app_user_id(v_uid)
    and p.is_withdrawn is not true
  limit 1;

  if v_profile_id is null then
    raise exception 'profile_not_found';
  end if;

  insert into public.meeting_reviews (
    meeting_id,
    reviewer_app_user_id,
    place_id,
    rating,
    selected_keywords,
    comment
  )
  values (
    v_mid,
    v_uid,
    v_place_uuid,
    p_rating::smallint,
    v_keywords,
    v_comment
  )
  on conflict (meeting_id, reviewer_app_user_id) do update
  set
    place_id = excluded.place_id,
    rating = excluded.rating,
    selected_keywords = excluded.selected_keywords,
    comment = excluded.comment,
    created_at = now()
  returning (xmax = 0) into v_inserted;

  perform public.refresh_place_rating_stats(v_place_uuid);

  if coalesce(v_inserted, false) then
    v_pol := coalesce(public.get_policy_jsonb('meeting', 'place_review'), '{}'::jsonb);

    v_xp := greatest(
      0,
      round(coalesce(nullif(trim(v_pol->>'xp_reward'), '')::numeric, 10::numeric))::int
    );
    v_trust_delta := greatest(
      0,
      round(coalesce(nullif(trim(v_pol->>'trust_reward'), '')::numeric, 3::numeric))::int
    );
    v_trust_cap := greatest(
      0,
      least(100, round(coalesce(nullif(trim(v_pol->>'trust_cap'), '')::numeric, 100::numeric))::int)
    );

    if v_xp > 0 then
      insert into public.xp_events (profile_id, kind, meeting_id, dedupe_key, xp_delta)
      values (
        v_profile_id,
        'meeting_place_review',
        v_mid,
        'place_review:' || v_mid::text || ':' || public.ginit_normalize_app_user_id(v_uid),
        v_xp
      )
      on conflict do nothing;

      get diagnostics v_xp_rows = row_count;
      if v_xp_rows > 0 then
        update public.profiles
        set g_xp = g_xp + v_xp
        where id = v_profile_id;
        v_xp_granted := v_xp;
      end if;
    end if;

    if v_trust_delta > 0 then
      update public.profiles
      set g_trust = least(v_trust_cap, g_trust + v_trust_delta)
      where id = v_profile_id;
      v_trust_granted := v_trust_delta;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'place_id', v_place_uuid,
    'rewards_applied', coalesce(v_inserted, false),
    'xp_granted', v_xp_granted,
    'trust_granted', v_trust_granted
  );
end;
$$;

revoke all on function public.upsert_meeting_place_review(
  text, text, text, integer, text[], text, text, text, text, double precision, double precision, text, text, text
) from public;
grant execute on function public.upsert_meeting_place_review(
  text, text, text, integer, text[], text, text, text, text, double precision, double precision, text, text, text
) to anon, authenticated;

notify pgrst, 'reload schema';
