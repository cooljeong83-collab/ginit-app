-- Admin: place_promotions CRUD, conversion reports, campaign upsert, feed preview

-- ─── place_promotions CRUD ───────────────────────────────────────────────────
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

revoke all on function public.admin_list_place_promotions(int, timestamptz, text, uuid, boolean) from public;
grant execute on function public.admin_list_place_promotions(int, timestamptz, text, uuid, boolean) to authenticated;

create or replace function public.admin_get_place_promotion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pp public.place_promotions%rowtype;
  v_pl public.places%rowtype;
  v_c public.sponsor_campaigns%rowtype;
  v_s public.sponsors%rowtype;
begin
  perform public.assert_current_user_admin();

  select * into v_pp from public.place_promotions where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;

  select * into v_pl from public.places where id = v_pp.place_id;
  select * into v_c from public.sponsor_campaigns where id = v_pp.campaign_id;
  select * into v_s from public.sponsors where id = v_c.sponsor_id;

  return jsonb_build_object(
    'promotion', to_jsonb(v_pp),
    'place', to_jsonb(v_pl),
    'campaign', to_jsonb(v_c),
    'sponsor', to_jsonb(v_s)
  );
end;
$$;

revoke all on function public.admin_get_place_promotion(uuid) from public;
grant execute on function public.admin_get_place_promotion(uuid) to authenticated;

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
        target_region_norms,
        priority
      )
      values (
        v_place_id,
        v_campaign_id,
        v_benefit_label,
        v_badge_label,
        v_is_active,
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

revoke all on function public.admin_upsert_place_promotion(jsonb) from public;
grant execute on function public.admin_upsert_place_promotion(jsonb) to authenticated;

create or replace function public.admin_set_place_promotion_active(
  p_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  update public.place_promotions
  set is_active = coalesce(p_is_active, false)
  where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.admin_set_place_promotion_active(uuid, boolean) from public;
grant execute on function public.admin_set_place_promotion_active(uuid, boolean) to authenticated;

-- ─── promotion_match_verifications (read-only) ───────────────────────────────
create or replace function public.admin_list_promotion_match_verifications(
  p_limit int default 25,
  p_cursor timestamptz default null,
  p_campaign_id uuid default null,
  p_place_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
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
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.verified_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      v.id,
      v.meeting_id,
      v.place_id,
      v.campaign_id,
      v.verifier_app_user_id,
      case
        when length(v.verifier_app_user_id) <= 4 then '****'
        else left(v.verifier_app_user_id, 4) || '****'
      end as verifier_masked,
      v.headcount,
      v.total_amount_won,
      v.benefit_received,
      v.match_success,
      v.verified_at,
      pl.place_name,
      pl.place_key,
      c.name as campaign_name
    from public.promotion_match_verifications v
    join public.places pl on pl.id = v.place_id
    join public.sponsor_campaigns c on c.id = v.campaign_id
    where (p_cursor is null or v.verified_at < p_cursor)
      and (p_campaign_id is null or v.campaign_id = p_campaign_id)
      and (p_place_id is null or v.place_id = p_place_id)
      and (p_from is null or v.verified_at >= p_from)
      and (p_to is null or v.verified_at < p_to)
    order by v.verified_at desc
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'verified_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'verified_at') desc), '[]'::jsonb)
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

revoke all on function public.admin_list_promotion_match_verifications(int, timestamptz, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_list_promotion_match_verifications(int, timestamptz, uuid, uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_promotion_match_stats(
  p_campaign_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  perform public.assert_current_user_admin();

  select
    count(*)::int as verification_count,
    count(*) filter (where v.benefit_received)::int as benefit_received_count,
    count(*) filter (where v.match_success)::int as match_success_count,
    coalesce(sum(v.headcount), 0)::bigint as sum_headcount,
    coalesce(sum(v.total_amount_won), 0)::bigint as sum_total_amount_won,
    count(distinct v.meeting_id)::int as unique_meetings
  into v_row
  from public.promotion_match_verifications v
  where (p_campaign_id is null or v.campaign_id = p_campaign_id)
    and (p_from is null or v.verified_at >= p_from)
    and (p_to is null or v.verified_at < p_to);

  return jsonb_build_object(
    'verification_count', coalesce(v_row.verification_count, 0),
    'benefit_received_count', coalesce(v_row.benefit_received_count, 0),
    'match_success_count', coalesce(v_row.match_success_count, 0),
    'sum_headcount', coalesce(v_row.sum_headcount, 0),
    'sum_total_amount_won', coalesce(v_row.sum_total_amount_won, 0),
    'unique_meetings', coalesce(v_row.unique_meetings, 0)
  );
end;
$$;

revoke all on function public.admin_promotion_match_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_promotion_match_stats(uuid, timestamptz, timestamptz) to authenticated;

-- ─── meeting_preset_place_create_intents (read-only) ─────────────────────────
create or replace function public.admin_list_preset_place_create_intents(
  p_entry_source text default null,
  p_campaign_id uuid default null,
  p_limit int default 25,
  p_cursor timestamptz default null,
  p_from timestamptz default null,
  p_to timestamptz default null
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
  v_source text := nullif(trim(coalesce(p_entry_source, '')), '');
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.intent_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      i.id,
      i.entry_source,
      i.entry_context,
      i.analytics_place_id,
      i.creator_app_user_id,
      case
        when length(i.creator_app_user_id) <= 4 then '****'
        else left(i.creator_app_user_id, 4) || '****'
      end as creator_masked,
      i.intent_at,
      i.converted_at,
      i.created_meeting_id,
      i.place_name,
      coalesce(i.entry_context->>'campaignId', '') as campaign_id_text
    from public.meeting_preset_place_create_intents i
    where (p_cursor is null or i.intent_at < p_cursor)
      and (v_source is null or i.entry_source = v_source)
      and (
        p_campaign_id is null
        or (i.entry_context->>'campaignId')::uuid = p_campaign_id
      )
      and (p_from is null or i.intent_at >= p_from)
      and (p_to is null or i.intent_at < p_to)
    order by i.intent_at desc
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'intent_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'intent_at') desc), '[]'::jsonb)
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

revoke all on function public.admin_list_preset_place_create_intents(text, uuid, int, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.admin_list_preset_place_create_intents(text, uuid, int, timestamptz, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_preset_place_intent_stats(
  p_campaign_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_intent_count int;
  v_converted_count int;
begin
  perform public.assert_current_user_admin();

  select
    count(*)::int,
    count(*) filter (where i.converted_at is not null)::int
  into v_intent_count, v_converted_count
  from public.meeting_preset_place_create_intents i
  where i.entry_source = 'store_promo'
    and (p_campaign_id is null or (i.entry_context->>'campaignId')::uuid = p_campaign_id)
    and (p_from is null or i.intent_at >= p_from)
    and (p_to is null or i.intent_at < p_to);

  return jsonb_build_object(
    'intent_count', coalesce(v_intent_count, 0),
    'converted_count', coalesce(v_converted_count, 0),
    'conversion_rate',
      case
        when coalesce(v_intent_count, 0) = 0 then 0
        else round((v_converted_count::numeric / v_intent_count::numeric) * 100, 2)
      end
  );
end;
$$;

revoke all on function public.admin_preset_place_intent_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_preset_place_intent_stats(uuid, timestamptz, timestamptz) to authenticated;

-- ─── campaign upsert / status ────────────────────────────────────────────────
create or replace function public.admin_upsert_campaign(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_sponsor_id uuid := nullif(p_payload->>'sponsor_id', '')::uuid;
  v_name text := nullif(trim(coalesce(p_payload->>'name', '')), '');
  v_status text := coalesce(nullif(trim(p_payload->>'status'), ''), 'draft');
  v_budget bigint := coalesce((p_payload->>'budget_cents')::bigint, 0);
  v_start timestamptz := nullif(p_payload->>'start_at', '')::timestamptz;
  v_end timestamptz := nullif(p_payload->>'end_at', '')::timestamptz;
  v_regions text[];
begin
  perform public.assert_current_user_admin();

  if v_sponsor_id is null or not exists (select 1 from public.sponsors where id = v_sponsor_id) then
    raise exception 'sponsor_not_found';
  end if;
  if v_name is null then
    raise exception 'campaign_name_required';
  end if;
  if v_status not in ('draft', 'active', 'paused', 'ended') then
    raise exception 'invalid_campaign_status';
  end if;

  v_regions := coalesce(
    (
      select coalesce(array_agg(distinct nullif(trim(r), '')), '{}'::text[])
      from unnest(
        coalesce(
          (
            select array_agg(elem::text)
            from jsonb_array_elements_text(coalesce(p_payload->'target_regions', '[]'::jsonb)) as elem
          ),
          '{}'::text[]
        )
      ) as r
      where nullif(trim(r), '') is not null
    ),
    '{}'::text[]
  );

  if v_id is null then
    insert into public.sponsor_campaigns (
      sponsor_id,
      name,
      start_at,
      end_at,
      target_regions,
      target_category_ids,
      budget_cents,
      status
    )
    values (
      v_sponsor_id,
      v_name,
      v_start,
      v_end,
      v_regions,
      coalesce(
        (
          select array_agg(elem::text)
          from jsonb_array_elements_text(coalesce(p_payload->'target_category_ids', '[]'::jsonb)) as elem
        ),
        '{}'::text[]
      ),
      v_budget,
      v_status
    )
    returning id into v_id;
  else
    update public.sponsor_campaigns c
    set
      sponsor_id = v_sponsor_id,
      name = v_name,
      start_at = v_start,
      end_at = v_end,
      target_regions = v_regions,
      target_category_ids = coalesce(
        (
          select array_agg(elem::text)
          from jsonb_array_elements_text(coalesce(p_payload->'target_category_ids', '[]'::jsonb)) as elem
        ),
        c.target_category_ids
      ),
      budget_cents = v_budget,
      status = v_status
    where c.id = v_id;

    if not found then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_campaign(jsonb) from public;
grant execute on function public.admin_upsert_campaign(jsonb) to authenticated;

create or replace function public.admin_set_campaign_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
begin
  perform public.assert_current_user_admin();
  if v_status is null or v_status not in ('draft', 'active', 'paused', 'ended') then
    raise exception 'invalid_campaign_status';
  end if;
  update public.sponsor_campaigns set status = v_status where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.admin_set_campaign_status(uuid, text) from public;
grant execute on function public.admin_set_campaign_status(uuid, text) to authenticated;

create or replace function public.admin_get_campaign_summary(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.sponsor_campaigns%rowtype;
  v_active_promotions int;
  v_live boolean;
begin
  perform public.assert_current_user_admin();

  select * into v_c from public.sponsor_campaigns where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;

  select count(*)::int
  into v_active_promotions
  from public.place_promotions pp
  where pp.campaign_id = p_id and pp.is_active is true;

  v_live := v_c.status = 'active'
    and (v_c.start_at is null or v_c.start_at <= now())
    and (v_c.end_at is null or v_c.end_at > now());

  return jsonb_build_object(
    'campaign', to_jsonb(v_c),
    'active_promotion_count', v_active_promotions,
    'campaign_is_live', v_live,
    'feed_eligible_count',
      (
        select count(*)::int
        from public.place_promotions pp
        where pp.campaign_id = p_id
          and pp.is_active is true
          and public.place_promotion_campaign_is_live(pp.campaign_id)
      )
  );
end;
$$;

revoke all on function public.admin_get_campaign_summary(uuid) from public;
grant execute on function public.admin_get_campaign_summary(uuid) to authenticated;

-- ─── feed preview (admin only) ───────────────────────────────────────────────
create or replace function public.admin_preview_feed_sponsored_places(
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
  return public.list_feed_sponsored_places(p_region_norm, p_limit);
end;
$$;

revoke all on function public.admin_preview_feed_sponsored_places(text, int) from public;
grant execute on function public.admin_preview_feed_sponsored_places(text, int) to authenticated;

notify pgrst, 'reload schema';
