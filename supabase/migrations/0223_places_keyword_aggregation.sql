-- places: 후기 키워드 집계(top_keywords) + 검색 haystack(keyword_search_text)

create extension if not exists pg_trgm;

alter table public.places
  add column if not exists top_keywords jsonb not null default '[]'::jsonb,
  add column if not exists keyword_search_text text not null default '';

-- ─── 집계 갱신(평점·건수·키워드·검색 텍스트) ─────────────────────────────────
create or replace function public.refresh_place_aggregate_stats(p_place_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(3, 2);
  v_cnt int;
  v_keywords jsonb;
  v_haystack text;
  v_name text;
  v_cat text;
begin
  if p_place_id is null then
    return;
  end if;

  select pl.place_name, coalesce(pl.category, '')
  into v_name, v_cat
  from public.places pl
  where pl.id = p_place_id;

  if v_name is null then
    return;
  end if;

  select
    coalesce(round(avg(r.rating)::numeric, 2), 0.0),
    count(*)::int
  into v_avg, v_cnt
  from public.meeting_reviews r
  where r.place_id = p_place_id;

  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('keyword', k.keyword, 'count', k.cnt)
        order by k.cnt desc, k.keyword asc
      )
      from (
        select
          nullif(trim(kw.keyword), '') as keyword,
          count(*)::int as cnt
        from public.meeting_reviews r
        cross join lateral unnest(coalesce(r.selected_keywords, '{}'::text[])) as kw(keyword)
        where r.place_id = p_place_id
          and nullif(trim(kw.keyword), '') is not null
        group by nullif(trim(kw.keyword), '')
        order by count(*) desc, nullif(trim(kw.keyword), '') asc
        limit 20
      ) k
    ),
    '[]'::jsonb
  )
  into v_keywords;

  select trim(
    concat_ws(
      ' ',
      v_name,
      nullif(v_cat, ''),
      (
        select coalesce(string_agg(distinct nullif(trim(kw.keyword), ''), ' '), '')
        from public.meeting_reviews r
        cross join lateral unnest(coalesce(r.selected_keywords, '{}'::text[])) as kw(keyword)
        where r.place_id = p_place_id
          and nullif(trim(kw.keyword), '') is not null
      )
    )
  )
  into v_haystack;

  update public.places pl
  set
    average_rating = coalesce(v_avg, 0.0),
    review_count = coalesce(v_cnt, 0),
    top_keywords = coalesce(v_keywords, '[]'::jsonb),
    keyword_search_text = coalesce(v_haystack, ''),
    updated_at = now()
  where pl.id = p_place_id;
end;
$$;

revoke all on function public.refresh_place_aggregate_stats(uuid) from public;

-- 레거시 호출 호환
create or replace function public.refresh_place_rating_stats(p_place_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_place_aggregate_stats(p_place_id);
end;
$$;

revoke all on function public.refresh_place_rating_stats(uuid) from public;

-- 백필
do $$
declare
  pid uuid;
begin
  for pid in select id from public.places
  loop
    perform public.refresh_place_aggregate_stats(pid);
  end loop;
end;
$$;

-- 검색 인덱스
create index if not exists places_keyword_search_text_trgm_idx
  on public.places using gin (keyword_search_text gin_trgm_ops);

-- ─── get_places_by_keys: top_keywords 포함 ─────────────────────────────────
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
          'top_keywords', coalesce(pl.top_keywords, '[]'::jsonb),
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

-- ─── 키워드·haystack 검색(추후 앱 연동) ─────────────────────────────────────
create or replace function public.search_places_by_keyword(
  p_query text,
  p_limit int default 30
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
        where pl.review_count > 0
          and pl.keyword_search_text ilike '%' || v_q || '%'
        order by pl.review_count desc, pl.average_rating desc
        limit v_limit
      ) x
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.search_places_by_keyword(text, int) from public;
grant execute on function public.search_places_by_keyword(text, int) to anon, authenticated;

-- ─── upsert_meeting_place_review: 집계 함수 호출 갱신 ───────────────────────
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

  perform public.refresh_place_aggregate_stats(v_place_uuid);

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
