-- Local place promotions (feed match, vote badges, settlement verify) + app RPCs

-- ─── place_promotions ───────────────────────────────────────────────────────
create table if not exists public.place_promotions (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id) on delete cascade,
  campaign_id uuid not null references public.sponsor_campaigns (id) on delete cascade,
  benefit_label text not null default '제휴 혜택',
  badge_label text not null default '지닛 매치 추천',
  is_active boolean not null default true,
  target_region_norms text[] not null default '{}',
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_promotions_place_id_unique unique (place_id)
);

create index if not exists place_promotions_active_priority_idx
  on public.place_promotions (is_active, priority desc, updated_at desc);

create index if not exists place_promotions_campaign_idx
  on public.place_promotions (campaign_id);

drop trigger if exists trg_place_promotions_touch on public.place_promotions;
create trigger trg_place_promotions_touch
before update on public.place_promotions
for each row execute function public.touch_updated_at();

alter table public.place_promotions enable row level security;
revoke all on table public.place_promotions from public;
revoke all on table public.place_promotions from anon;
revoke all on table public.place_promotions from authenticated;

-- ─── promotion_match_verifications ──────────────────────────────────────────
create table if not exists public.promotion_match_verifications (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete restrict,
  campaign_id uuid not null references public.sponsor_campaigns (id) on delete restrict,
  verifier_app_user_id text not null,
  headcount int not null default 0,
  total_amount_won bigint not null default 0,
  benefit_received boolean not null default false,
  match_success boolean not null default false,
  verified_at timestamptz not null default now(),
  constraint promotion_match_verifications_headcount_nonneg check (headcount >= 0),
  constraint promotion_match_verifications_amount_nonneg check (total_amount_won >= 0),
  constraint promotion_match_verifications_meeting_verifier_ux
    unique (meeting_id, verifier_app_user_id)
);

create index if not exists promotion_match_verifications_meeting_idx
  on public.promotion_match_verifications (meeting_id, verified_at desc);

create index if not exists promotion_match_verifications_campaign_idx
  on public.promotion_match_verifications (campaign_id, verified_at desc);

alter table public.promotion_match_verifications enable row level security;
revoke all on table public.promotion_match_verifications from public;
revoke all on table public.promotion_match_verifications from anon;
revoke all on table public.promotion_match_verifications from authenticated;

-- ─── helpers ────────────────────────────────────────────────────────────────
create or replace function public.place_promotion_campaign_is_live(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sponsor_campaigns c
    where c.id = p_campaign_id
      and c.status = 'active'
      and (c.start_at is null or c.start_at <= now())
      and (c.end_at is null or c.end_at > now())
  );
$$;

create or replace function public.place_promotion_matches_region(
  p_target_regions text[],
  p_region_norm text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(array_length(p_target_regions, 1), 0) = 0
    or nullif(trim(coalesce(p_region_norm, '')), '') is null
    or nullif(trim(coalesce(p_region_norm, '')), '') = any (
      select nullif(trim(r), '')
      from unnest(coalesce(p_target_regions, '{}'::text[])) as r
      where nullif(trim(r), '') is not null
    );
$$;

create or replace function public.resolve_meeting_place_key_for_promotion(p_meeting_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_m public.meetings%rowtype;
  v_key text;
  v_chip_id text;
  v_candidates jsonb;
  v_elem jsonb;
  v_i int;
begin
  select * into v_m from public.meetings where id = p_meeting_id;
  if not found then
    return null;
  end if;

  v_key := nullif(trim(coalesce(v_m.place_key, '')), '');
  if v_key is not null then
    return v_key;
  end if;

  v_chip_id := nullif(trim(coalesce(v_m.confirmed_place_chip_id, '')), '');
  v_candidates := case
    when v_m.extra_data is not null
      and jsonb_typeof(v_m.extra_data) = 'object'
      and jsonb_typeof(v_m.extra_data->'place_candidates') = 'array'
    then v_m.extra_data->'place_candidates'
    else '[]'::jsonb
  end;

  if v_chip_id is not null then
    for v_i in 0 .. greatest(jsonb_array_length(v_candidates) - 1, 0) loop
      v_elem := v_candidates->v_i;
      if jsonb_typeof(v_elem) <> 'object' then
        continue;
      end if;
      if nullif(trim(coalesce(v_elem->>'id', '')), '') = v_chip_id then
        v_key := nullif(trim(coalesce(v_elem->>'placeKey', v_elem->>'place_key', '')), '');
        if v_key is not null then
          return v_key;
        end if;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_candidates) > 0 then
    v_elem := v_candidates->0;
    if jsonb_typeof(v_elem) = 'object' then
      v_key := nullif(trim(coalesce(v_elem->>'placeKey', v_elem->>'place_key', '')), '');
      if v_key is not null then
        return v_key;
      end if;
    end if;
  end if;

  return public.ginit_derive_place_key_from_name_address(
    coalesce(nullif(trim(v_m.place_name), ''), '장소'),
    coalesce(v_m.address, '')
  );
end;
$$;

revoke all on function public.resolve_meeting_place_key_for_promotion(uuid) from public;
grant execute on function public.resolve_meeting_place_key_for_promotion(uuid) to authenticated;

-- ─── list_feed_sponsored_places ─────────────────────────────────────────────
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

revoke all on function public.list_feed_sponsored_places(text, int) from public;
grant execute on function public.list_feed_sponsored_places(text, int) to anon, authenticated;

-- ─── get_place_promotions_by_keys ───────────────────────────────────────────
create or replace function public.get_place_promotions_by_keys(p_place_keys text[])
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

  if coalesce(array_length(v_keys, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'place_key', pl.place_key,
          'place_id', pl.id,
          'is_sponsored', true,
          'benefit_label', pp.benefit_label,
          'badge_label', pp.badge_label,
          'campaign_id', pp.campaign_id,
          'promotion_id', pp.id
        )
        order by pl.place_key
      )
      from public.places pl
      join public.place_promotions pp on pp.place_id = pl.id
      where pl.place_key = any (v_keys)
        and pp.is_active is true
        and public.place_promotion_campaign_is_live(pp.campaign_id)
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_place_promotions_by_keys(text[]) from public;
grant execute on function public.get_place_promotions_by_keys(text[]) to anon, authenticated;

-- ─── resolve_meeting_place_promotion ────────────────────────────────────────
create or replace function public.resolve_meeting_place_promotion(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mid uuid := p_meeting_id;
  v_key text;
  v_pp public.place_promotions%rowtype;
  v_pl public.places%rowtype;
begin
  if v_mid is null then
    return null;
  end if;

  v_key := public.resolve_meeting_place_key_for_promotion(v_mid);
  if v_key is null then
    return null;
  end if;

  select pl.* into v_pl from public.places pl where pl.place_key = v_key limit 1;
  if not found then
    return null;
  end if;

  select pp.* into v_pp
  from public.place_promotions pp
  where pp.place_id = v_pl.id
    and pp.is_active is true
    and public.place_promotion_campaign_is_live(pp.campaign_id)
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'is_sponsored', true,
    'promotion_id', v_pp.id,
    'campaign_id', v_pp.campaign_id,
    'place_id', v_pl.id,
    'place_key', v_pl.place_key,
    'place_name', v_pl.place_name,
    'benefit_label', v_pp.benefit_label,
    'badge_label', v_pp.badge_label
  );
end;
$$;

revoke all on function public.resolve_meeting_place_promotion(uuid) from public;
grant execute on function public.resolve_meeting_place_promotion(uuid) to anon, authenticated;

-- ─── submit_promotion_match_verify ──────────────────────────────────────────
create or replace function public.submit_promotion_match_verify(
  p_meeting_id uuid,
  p_verifier_app_user_id text,
  p_headcount int,
  p_total_amount_won bigint,
  p_benefit_received boolean,
  p_match_success boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid := p_meeting_id;
  v_verifier text := nullif(trim(coalesce(p_verifier_app_user_id, '')), '');
  v_promo jsonb;
  v_place_id uuid;
  v_campaign_id uuid;
  v_match_success boolean;
  v_id uuid;
begin
  if v_mid is null then
    raise exception 'meeting_id_required';
  end if;
  if v_verifier is null then
    raise exception 'verifier_required';
  end if;

  v_promo := public.resolve_meeting_place_promotion(v_mid);
  if v_promo is null then
    raise exception 'meeting_place_not_sponsored';
  end if;

  v_place_id := (v_promo->>'place_id')::uuid;
  v_campaign_id := (v_promo->>'campaign_id')::uuid;
  v_match_success := coalesce(p_match_success, p_benefit_received);

  insert into public.promotion_match_verifications (
    meeting_id,
    place_id,
    campaign_id,
    verifier_app_user_id,
    headcount,
    total_amount_won,
    benefit_received,
    match_success
  )
  values (
    v_mid,
    v_place_id,
    v_campaign_id,
    v_verifier,
    greatest(coalesce(p_headcount, 0), 0),
    greatest(coalesce(p_total_amount_won, 0), 0),
    coalesce(p_benefit_received, false),
    coalesce(v_match_success, false)
  )
  on conflict (meeting_id, verifier_app_user_id) do update set
    headcount = excluded.headcount,
    total_amount_won = excluded.total_amount_won,
    benefit_received = excluded.benefit_received,
    match_success = excluded.match_success,
    verified_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_promotion_match_verify(uuid, text, int, bigint, boolean, boolean) from public;
grant execute on function public.submit_promotion_match_verify(uuid, text, int, bigint, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
