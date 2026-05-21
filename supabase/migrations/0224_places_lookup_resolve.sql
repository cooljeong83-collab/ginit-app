-- 장소 후기·집계 조회: place_key / naver 링크 / 상호+주소 파생키 / 레거시 키 별칭 통합

create or replace function public.ginit_derive_place_key_from_name_address(
  p_place_name text,
  p_road_address text
)
returns text
language sql
immutable
as $$
  select
    regexp_replace(coalesce(nullif(trim(p_place_name), ''), '장소'), '\s+', '', 'g')
    || '_'
    || regexp_replace(coalesce(nullif(trim(p_road_address), ''), ''), '\s+', '', 'g');
$$;

create or replace function public.resolve_place_ids_for_lookup(
  p_lookup_keys text[],
  p_place_name text default null,
  p_road_address text default null
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_keys text[];
  v_derived text;
  v_ids uuid[];
begin
  v_keys := (
    select coalesce(array_agg(distinct k), '{}'::text[])
    from (
      select nullif(trim(x), '') as k
      from unnest(coalesce(p_lookup_keys, '{}'::text[])) as x
    ) t
    where k is not null
  );

  v_derived := public.ginit_derive_place_key_from_name_address(p_place_name, p_road_address);
  if v_derived is not null and nullif(trim(v_derived), '') is not null and not (v_derived = any (v_keys)) then
    v_keys := array_append(v_keys, v_derived);
  end if;

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return '{}'::uuid[];
  end if;

  select coalesce(array_agg(distinct pl.id), '{}'::uuid[])
  into v_ids
  from public.places pl
  where pl.place_key = any (v_keys)
     or pl.naver_place_link = any (v_keys);

  return coalesce(v_ids, '{}'::uuid[]);
end;
$$;

revoke all on function public.resolve_place_ids_for_lookup(text[], text, text) from public;
grant execute on function public.resolve_place_ids_for_lookup(text[], text, text) to anon, authenticated;

-- ─── get_places_by_keys: naver 링크·파생키 별칭 매칭 ───────────────────────
create or replace function public.get_places_by_keys(
  p_place_keys text[],
  p_place_name text default null,
  p_road_address text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  v_ids := public.resolve_place_ids_for_lookup(p_place_keys, p_place_name, p_road_address);

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'place_key', pl.place_key,
          'id', pl.id,
          'place_name', pl.place_name,
          'average_rating', pl.average_rating,
          'review_count', pl.review_count,
          'top_keywords', coalesce(pl.top_keywords, '[]'::jsonb),
          'category', pl.category,
          'road_address', pl.road_address,
          'preferred_photo_media_url', pl.preferred_photo_media_url,
          'naver_place_link', pl.naver_place_link,
          'latitude', pl.latitude,
          'longitude', pl.longitude
        )
        order by pl.review_count desc, pl.average_rating desc, pl.place_key
      )
      from public.places pl
      where pl.id = any (v_ids)
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_places_by_keys(text[]) from public;
revoke all on function public.get_places_by_keys(text[], text, text) from public;
grant execute on function public.get_places_by_keys(text[], text, text) to anon, authenticated;

-- ─── list_place_reviews_by_place_key: 통합 place_id 집합 조회 ───────────────
create or replace function public.list_place_reviews_by_place_key(
  p_place_key text,
  p_limit int default 20,
  p_cursor timestamptz default null,
  p_lookup_keys text[] default null,
  p_place_name text default null,
  p_road_address text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := nullif(trim(p_place_key), '');
  v_keys text[];
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_place_ids uuid[];
  v_items jsonb;
  v_next timestamptz;
  v_raw_count int;
begin
  v_keys := (
    select coalesce(array_agg(distinct k), '{}'::text[])
    from (
      select nullif(trim(x), '') as k
      from unnest(
        array_cat(
          coalesce(case when v_key is not null then array[v_key] else '{}'::text[] end, '{}'::text[]),
          coalesce(p_lookup_keys, '{}'::text[])
        )
      ) as x
    ) t
    where k is not null
  );

  v_place_ids := public.resolve_place_ids_for_lookup(v_keys, p_place_name, p_road_address);

  if coalesce(array_length(v_place_ids, 1), 0) = 0 then
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
    where r.place_id = any (v_place_ids)
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
revoke all on function public.list_place_reviews_by_place_key(text, int, timestamptz, text[], text, text) from public;
grant execute on function public.list_place_reviews_by_place_key(text, int, timestamptz, text[], text, text)
  to anon, authenticated;
