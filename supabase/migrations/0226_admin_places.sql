-- Admin places: cursor list (5/page), detail, upsert, stats refresh

create or replace function public.admin_list_places(
  p_limit int default 5,
  p_cursor timestamptz default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 20));
  v_items jsonb;
  v_next timestamptz;
  v_raw_count int;
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      pl.id,
      pl.place_key,
      pl.place_name,
      pl.road_address,
      pl.category,
      pl.average_rating,
      pl.review_count,
      pl.updated_at,
      pl.created_at
    from public.places pl
    where (p_cursor is null or pl.updated_at < p_cursor)
      and (
        v_q is null
        or pl.place_name ilike '%' || v_q || '%'
        or pl.place_key ilike '%' || v_q || '%'
        or pl.road_address ilike '%' || v_q || '%'
        or coalesce(pl.category, '') ilike '%' || v_q || '%'
      )
    order by pl.updated_at desc
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'updated_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'updated_at') desc), '[]'::jsonb)
      from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      where ord <= v_limit
    );
  else
    v_next := null;
  end if;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next
  );
end;
$$;

revoke all on function public.admin_list_places(int, timestamptz, text) from public;
grant execute on function public.admin_list_places(int, timestamptz, text) to authenticated;

create or replace function public.admin_get_place(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.places%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.places where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_get_place(uuid) from public;
grant execute on function public.admin_get_place(uuid) to authenticated;

create or replace function public.admin_upsert_place(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place_key text := nullif(trim(coalesce(p_payload->>'place_key', '')), '');
  v_place_name text := nullif(trim(coalesce(p_payload->>'place_name', '')), '');
  v_road_address text := nullif(trim(coalesce(p_payload->>'road_address', '')), '');
  v_lat double precision;
  v_lng double precision;
  v_id uuid;
begin
  perform public.assert_current_user_admin();

  if v_place_key is null or v_place_name is null or v_road_address is null then
    raise exception 'place_key_place_name_road_address_required';
  end if;

  if p_payload->>'latitude' is not null and trim(p_payload->>'latitude') <> '' then
    v_lat := (p_payload->>'latitude')::double precision;
  end if;
  if p_payload->>'longitude' is not null and trim(p_payload->>'longitude') <> '' then
    v_lng := (p_payload->>'longitude')::double precision;
  end if;

  v_id := public.upsert_place_master(
    v_place_key,
    v_place_name,
    v_road_address,
    v_lat,
    v_lng,
    p_payload->>'category',
    p_payload->>'naver_place_link',
    p_payload->>'preferred_photo_media_url'
  );

  perform public.refresh_place_aggregate_stats(v_id);

  return jsonb_build_object('id', v_id, 'place_key', v_place_key);
end;
$$;

revoke all on function public.admin_upsert_place(jsonb) from public;
grant execute on function public.admin_upsert_place(jsonb) to authenticated;

create or replace function public.admin_refresh_place_stats(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  if p_id is null then
    raise exception 'id_required';
  end if;
  if not exists (select 1 from public.places where id = p_id) then
    raise exception 'not_found';
  end if;
  perform public.refresh_place_aggregate_stats(p_id);
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.admin_refresh_place_stats(uuid) from public;
grant execute on function public.admin_refresh_place_stats(uuid) to authenticated;
