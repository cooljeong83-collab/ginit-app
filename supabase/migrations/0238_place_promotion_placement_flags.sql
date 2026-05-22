-- Placement channel flags: feed inline vs place-search boost (admin toggles per promotion)

alter table public.place_promotions
  add column if not exists expose_in_feed boolean not null default true,
  add column if not exists boost_in_place_search boolean not null default false;

comment on column public.place_promotions.expose_in_feed is
  'When true, eligible for home feed sponsored inline card (list_feed_sponsored_places).';
comment on column public.place_promotions.boost_in_place_search is
  'When true, eligible for top injection in VoteCandidatesForm place search (list_sponsored_places_for_search).';

update public.place_promotions
set
  expose_in_feed = coalesce(expose_in_feed, true),
  boost_in_place_search = coalesce(boost_in_place_search, false);

create index if not exists place_promotions_feed_placement_idx
  on public.place_promotions (is_active, expose_in_feed, priority desc, updated_at desc)
  where expose_in_feed is true;

create index if not exists place_promotions_search_boost_idx
  on public.place_promotions (is_active, boost_in_place_search, priority desc, updated_at desc)
  where boost_in_place_search is true;

-- ─── list_feed_sponsored_places (feed channel only) ───────────────────────────
create or replace function public.list_feed_sponsored_places(
  p_region_norm text default null,
  p_limit int default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 1), 5));
  v_region text := nullif(trim(coalesce(p_region_norm, '')), '');
begin
  return coalesce(
    (
      select jsonb_agg(row_to_json(t)::jsonb order by t.priority desc, t.updated_at desc)
      from (
        select
          pp.id as promotion_id,
          pp.campaign_id,
          pp.benefit_label,
          pp.badge_label,
          pl.id as place_id,
          pl.place_key,
          pl.place_name,
          pl.road_address,
          pl.category,
          pl.preferred_photo_media_url,
          pl.naver_place_link,
          pl.latitude,
          pl.longitude,
          pl.average_rating,
          pl.review_count,
          pp.priority,
          pp.updated_at
        from public.place_promotions pp
        join public.places pl on pl.id = pp.place_id
        where pp.is_active is true
          and pp.expose_in_feed is true
          and public.place_promotion_campaign_is_live(pp.campaign_id)
          and public.place_promotion_matches_region(pp.target_region_norms, v_region)
        order by pp.priority desc, pp.updated_at desc
        limit v_limit
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

-- ─── list_sponsored_places_for_search (search boost channel only) ─────────────
create or replace function public.list_sponsored_places_for_search(
  p_region_norm text default null,
  p_limit int default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 1), 5));
  v_region text := nullif(trim(coalesce(p_region_norm, '')), '');
begin
  return coalesce(
    (
      select jsonb_agg(row_to_json(t)::jsonb order by t.priority desc, t.updated_at desc)
      from (
        select
          pp.id as promotion_id,
          pp.campaign_id,
          pp.benefit_label,
          pp.badge_label,
          pl.id as place_id,
          pl.place_key,
          pl.place_name,
          pl.road_address,
          pl.category,
          pl.preferred_photo_media_url,
          pl.naver_place_link,
          pl.latitude,
          pl.longitude,
          pl.average_rating,
          pl.review_count,
          pp.priority,
          pp.updated_at
        from public.place_promotions pp
        join public.places pl on pl.id = pp.place_id
        where pp.is_active is true
          and pp.boost_in_place_search is true
          and public.place_promotion_campaign_is_live(pp.campaign_id)
          and public.place_promotion_matches_region(pp.target_region_norms, v_region)
        order by pp.priority desc, pp.updated_at desc
        limit v_limit
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_sponsored_places_for_search(text, int) from public;
grant execute on function public.list_sponsored_places_for_search(text, int) to anon, authenticated;

-- ─── admin CRUD: placement flags ──────────────────────────────────────────────
create or replace function public.admin_list_place_promotions(
  p_limit int default 25,
  p_cursor timestamptz default null,
  p_search text default null,
  p_campaign_id uuid default null,
  p_is_active boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 25), 100));
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
      pp.id,
      pp.place_id,
      pp.campaign_id,
      pp.benefit_label,
      pp.badge_label,
      pp.is_active,
      pp.expose_in_feed,
      pp.boost_in_place_search,
      pp.target_region_norms,
      pp.priority,
      pp.created_at,
      pp.updated_at,
      pl.place_key,
      pl.place_name,
      c.name as campaign_name,
      s.name as sponsor_name
    from public.place_promotions pp
    join public.places pl on pl.id = pp.place_id
    join public.sponsor_campaigns c on c.id = pp.campaign_id
    join public.sponsors s on s.id = c.sponsor_id
    where (p_cursor is null or pp.updated_at < p_cursor)
      and (p_campaign_id is null or pp.campaign_id = p_campaign_id)
      and (p_is_active is null or pp.is_active = p_is_active)
      and (
        v_q is null
        or pl.place_name ilike '%' || v_q || '%'
        or pl.place_key ilike '%' || v_q || '%'
        or pp.benefit_label ilike '%' || v_q || '%'
      )
    order by pp.updated_at desc
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

create or replace function public.admin_upsert_place_promotion(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_place_id uuid := nullif(p_payload->>'place_id', '')::uuid;
  v_place_key text := nullif(trim(coalesce(p_payload->>'place_key', '')), '');
  v_campaign_id uuid := nullif(p_payload->>'campaign_id', '')::uuid;
  v_benefit_label text := nullif(trim(coalesce(p_payload->>'benefit_label', '')), '');
  v_badge_label text := coalesce(
    nullif(trim(coalesce(p_payload->>'badge_label', '')), ''),
    '지닛 매치 추천'
  );
  v_is_active boolean := coalesce((p_payload->>'is_active')::boolean, true);
  v_expose_in_feed boolean := coalesce((p_payload->>'expose_in_feed')::boolean, true);
  v_boost_in_place_search boolean := coalesce((p_payload->>'boost_in_place_search')::boolean, false);
  v_priority int := coalesce((p_payload->>'priority')::int, 0);
  v_regions text[];
begin
  perform public.assert_current_user_admin();

  if v_benefit_label is null then
    raise exception 'benefit_label_required';
  end if;

  if v_place_id is null and v_place_key is not null then
    select pl.id into v_place_id from public.places pl where pl.place_key = v_place_key limit 1;
    if v_place_id is null then
      raise exception 'place_not_found';
    end if;
  end if;

  if v_place_id is null then
    raise exception 'place_id_required';
  end if;

  if not exists (select 1 from public.places where id = v_place_id) then
    raise exception 'place_not_found';
  end if;

  if v_campaign_id is null or not exists (
    select 1 from public.sponsor_campaigns where id = v_campaign_id
  ) then
    raise exception 'campaign_not_found';
  end if;

  v_regions := coalesce(
    (
      select coalesce(array_agg(distinct nullif(trim(r), '')), '{}'::text[])
      from unnest(
        coalesce(
          (
            select array_agg(elem::text)
            from jsonb_array_elements_text(coalesce(p_payload->'target_region_norms', '[]'::jsonb)) as elem
          ),
          '{}'::text[]
        )
      ) as r
      where nullif(trim(r), '') is not null
    ),
    '{}'::text[]
  );

  if v_id is null then
    begin
      insert into public.place_promotions (
        place_id,
        campaign_id,
        benefit_label,
        badge_label,
        is_active,
        expose_in_feed,
        boost_in_place_search,
        target_region_norms,
        priority
      )
      values (
        v_place_id,
        v_campaign_id,
        v_benefit_label,
        v_badge_label,
        v_is_active,
        v_expose_in_feed,
        v_boost_in_place_search,
        v_regions,
        v_priority
      )
      returning id into v_id;
    exception
      when unique_violation then
        raise exception 'place_promotion_place_id_duplicate';
    end;
  else
    update public.place_promotions pp
    set
      place_id = v_place_id,
      campaign_id = v_campaign_id,
      benefit_label = v_benefit_label,
      badge_label = v_badge_label,
      is_active = v_is_active,
      expose_in_feed = v_expose_in_feed,
      boost_in_place_search = v_boost_in_place_search,
      target_region_norms = v_regions,
      priority = v_priority
    where pp.id = v_id;

    if not found then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_preview_search_boost_places(
  p_region_norm text default null,
  p_limit int default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return public.list_sponsored_places_for_search(p_region_norm, p_limit);
end;
$$;

revoke all on function public.admin_preview_search_boost_places(text, int) from public;
grant execute on function public.admin_preview_search_boost_places(text, int) to authenticated;

notify pgrst, 'reload schema';
