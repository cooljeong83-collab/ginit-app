-- Batch upsert places from app place search + optional keyword search tweak + admin prune

-- ─── search_places_by_keyword: optional unreviewed places ─────────────────
drop function if exists public.search_places_by_keyword(text, int);

create or replace function public.search_places_by_keyword(
  p_query text,
  p_limit int default 30,
  p_include_unreviewed boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 50);
begin
  if v_q is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(row_to_json(x)::jsonb order by x.review_count desc, x.average_rating desc)
      from (
        select
          pl.place_key,
          pl.id,
          pl.place_name,
          pl.average_rating,
          pl.review_count,
          coalesce(pl.top_keywords, '[]'::jsonb) as top_keywords,
          pl.category,
          pl.road_address,
          pl.preferred_photo_media_url,
          pl.naver_place_link,
          pl.latitude,
          pl.longitude
        from public.places pl
        where pl.keyword_search_text ilike '%' || v_q || '%'
          and (p_include_unreviewed or pl.review_count > 0)
        order by pl.review_count desc, pl.average_rating desc
        limit v_limit
      ) x
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.search_places_by_keyword(text, int, boolean) from public;
grant execute on function public.search_places_by_keyword(text, int, boolean) to anon, authenticated;

-- ─── sync_search_place_masters ───────────────────────────────────────────────
create or replace function public.sync_search_place_masters(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_keys text[];
  v_places jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object(
      'places', '[]'::jsonb,
      'inserted_count', 0,
      'updated_count', 0
    );
  end if;

  with incoming as (
    select
      nullif(trim(elem->>'place_key'), '') as place_key,
      nullif(trim(elem->>'place_name'), '') as place_name,
      nullif(trim(elem->>'road_address'), '') as road_address,
      case
        when elem->>'latitude' is not null and (elem->>'latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (elem->>'latitude')::double precision
        else null
      end as latitude,
      case
        when elem->>'longitude' is not null and (elem->>'longitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (elem->>'longitude')::double precision
        else null
      end as longitude,
      nullif(trim(elem->>'category'), '') as category,
      nullif(trim(elem->>'naver_place_link'), '') as naver_place_link,
      nullif(trim(elem->>'preferred_photo_media_url'), '') as preferred_photo_media_url
    from jsonb_array_elements(p_rows) as elem
  ),
  upserted as (
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
    select
      i.place_key,
      left(i.place_name, 255),
      i.road_address,
      case when i.latitude is not null then i.latitude::numeric(10, 7) else null end,
      case when i.longitude is not null then i.longitude::numeric(10, 7) else null end,
      i.category,
      i.naver_place_link,
      i.preferred_photo_media_url
    from incoming i
    where i.place_key is not null
      and i.place_name is not null
      and i.road_address is not null
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
    returning place_key, (xmax = 0) as was_inserted
  )
  select
    coalesce(count(*) filter (where was_inserted), 0),
    coalesce(count(*) filter (where not was_inserted), 0),
    coalesce(array_agg(distinct place_key), '{}'::text[])
  into v_inserted, v_updated, v_keys
  from upserted;

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    select coalesce(array_agg(distinct nullif(trim(elem->>'place_key'), '')), '{}'::text[])
    into v_keys
    from jsonb_array_elements(p_rows) as elem
    where nullif(trim(elem->>'place_key'), '') is not null;
  end if;

  v_places := public.get_places_by_keys(v_keys, null, null);

  return jsonb_build_object(
    'places', coalesce(v_places, '[]'::jsonb),
    'inserted_count', coalesce(v_inserted, 0),
    'updated_count', coalesce(v_updated, 0)
  );
end;
$$;

revoke all on function public.sync_search_place_masters(jsonb) from public;
grant execute on function public.sync_search_place_masters(jsonb) to authenticated;

-- ─── admin_prune_stale_places ────────────────────────────────────────────────
create or replace function public.admin_prune_stale_places(
  p_older_than interval default interval '180 days',
  p_limit int default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_cutoff timestamptz := now() - coalesce(p_older_than, interval '180 days');
  v_deleted int := 0;
begin
  perform public.assert_current_user_admin();

  with doomed as (
    select pl.id
    from public.places pl
    where pl.review_count = 0
      and pl.created_at < v_cutoff
      and not exists (
        select 1 from public.meeting_reviews mr where mr.place_id = pl.id
      )
      and not exists (
        select 1 from public.place_promotions pp where pp.place_id = pl.id
      )
    limit v_limit
  ),
  removed as (
    delete from public.places pl
    using doomed d
    where pl.id = d.id
    returning pl.id
  )
  select count(*)::int into v_deleted from removed;

  return jsonb_build_object('deleted_count', coalesce(v_deleted, 0));
end;
$$;

revoke all on function public.admin_prune_stale_places(interval, int) from public;
grant execute on function public.admin_prune_stale_places(interval, int) to authenticated;

notify pgrst, 'reload schema';
