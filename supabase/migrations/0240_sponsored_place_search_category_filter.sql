-- 장소 후보 검색 부스트: 캠페인 소분류(target_category_ids) + 장소 업종 + 모임 대분류(major_code) 매칭

-- ─── campaign 소분류 게이트 ───────────────────────────────────────────────────
create or replace function public.place_promotion_matches_target_categories(
  p_target_category_ids text[],
  p_category_id text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(array_length(p_target_category_ids, 1), 0) = 0
    or (
      nullif(trim(coalesce(p_category_id, '')), '') is not null
      and nullif(trim(coalesce(p_category_id, '')), '') = any (
        select nullif(trim(t), '')
        from unnest(coalesce(p_target_category_ids, '{}'::text[])) as t
        where nullif(trim(t), '') is not null
      )
    );
$$;

-- ─── 네이버 업종 → 버킷 (meeting-review-category.ts 정규식과 동기화) ─────────
create or replace function public.place_naver_category_bucket(
  p_category text,
  p_place_name text default null
)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  t := lower(regexp_replace(trim(coalesce(p_category, '')), '\s+', '', 'g'));
  if t = '' then
    t := lower(regexp_replace(trim(coalesce(p_place_name, '')), '\s+', '', 'g'));
  end if;
  if t = '' then
    return 'common';
  end if;

  if t ~ '카페|커피|디저트|베이커리|브런치|티룸|tea|북카페' then
    return 'cafe';
  end if;
  if t ~ '술|바|포차|이자카야|호프|펍|와인|맥주|주점|라운지|클럽|칵테일' then
    return 'bar';
  end if;
  if t ~ '영화|시네마|극장|멀티플렉스|cgv|megabox|메가박스|롯데시네마|무비|상영' then
    return 'movie';
  end if;
  if t ~ '스터디|독서실|도서관|코워킹|북클럽|학원|강의|세미나|토론|카공' then
    return 'knowledge';
  end if;
  if t ~ '전시|미술|박물관|갤러리|공연|뮤지컬|문화센터|아트' then
    return 'culture';
  end if;
  if t ~ '스크린골프|골프연습|골프장|파크골프|드라이빙레인지|골프존|프렌즈스크린|sg골프|퍼블릭골프' then
    return 'sports';
  end if;
  if t ~ '헬스|피트니스|요가|필라테스|크로스핏|수영|클라이밍|암장|체육관|운동장|풋살|축구장|배드민턴|테니스|볼링장|당구장|탁구|스포츠|트레이닝|짐|gym' then
    return 'sports';
  end if;
  if t ~ 'pc방|pc카페|피시방|피씨방|오락실|아케이드|게임장|e스포츠|esports|보드게임|방탈출|vr체험|vr카페|노래방|코인노래|게임카페|콘솔|닌텐도|플스방|오락|놀이터|키즈카페' then
    return 'entertainment';
  end if;
  if t ~ '볼링|당구|포켓볼|오락|놀이|테마파크|놀이공원' then
    return 'entertainment';
  end if;
  if t ~ '음식|식당|한식|중식|일식|양식|분식|뷔페|고기|회|치킨|피자|햄버거|맛집|레스토랑|요리' then
    return 'restaurant';
  end if;

  return 'common';
end;
$$;

-- ─── 모임 major_code → 허용 업종 버킷 ───────────────────────────────────────
create or replace function public.place_sponsored_search_matches_major(
  p_bucket text,
  p_major_code text
)
returns boolean
language plpgsql
immutable
as $$
declare
  mc text := lower(trim(coalesce(p_major_code, '')));
  b text := lower(trim(coalesce(p_bucket, 'common')));
begin
  if mc = '' then
    return false;
  end if;

  if mc in ('pcgame', 'play & vibe') then
    return b = 'entertainment';
  end if;

  if mc in ('eat & drink', 'cafe', 'food', 'meal', 'dining') then
    return b in ('cafe', 'restaurant', 'bar');
  end if;

  if mc in ('movie', 'cinema', 'film') then
    return b = 'movie';
  end if;

  if mc in ('active & life', 'sports', 'fitness', 'workout') then
    return b in ('sports', 'entertainment');
  end if;

  if mc in ('focus & knowledge') then
    return b in ('knowledge', 'culture', 'cafe');
  end if;

  return false;
end;
$$;

-- ─── list_sponsored_places_for_search (category + major 필터) ───────────────
drop function if exists public.list_sponsored_places_for_search(text, int);

create or replace function public.list_sponsored_places_for_search(
  p_region_norm text default null,
  p_limit int default 3,
  p_category_id text default null,
  p_major_code text default null
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
  v_category_id text := nullif(trim(coalesce(p_category_id, '')), '');
  v_major_code text := nullif(trim(coalesce(p_major_code, '')), '');
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
        join public.sponsor_campaigns c on c.id = pp.campaign_id
        where pp.is_active is true
          and pp.boost_in_place_search is true
          and public.place_promotion_campaign_is_live(pp.campaign_id)
          and public.place_promotion_matches_region(pp.target_region_norms, v_region)
          and public.place_promotion_matches_target_categories(c.target_category_ids, v_category_id)
          and public.place_sponsored_search_matches_major(
            public.place_naver_category_bucket(pl.category, pl.place_name),
            v_major_code
          )
        order by pp.priority desc, pp.updated_at desc
        limit v_limit
      ) t
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.list_sponsored_places_for_search(text, int, text, text) from public;
grant execute on function public.list_sponsored_places_for_search(text, int, text, text) to anon, authenticated;

-- ─── admin preview: 동일 필터 ─────────────────────────────────────────────────
drop function if exists public.admin_preview_search_boost_places(text, int);

create or replace function public.admin_preview_search_boost_places(
  p_region_norm text default null,
  p_limit int default 5,
  p_category_id text default null,
  p_major_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return public.list_sponsored_places_for_search(
    p_region_norm,
    p_limit,
    p_category_id,
    p_major_code
  );
end;
$$;

revoke all on function public.admin_preview_search_boost_places(text, int, text, text) from public;
grant execute on function public.admin_preview_search_boost_places(text, int, text, text) to authenticated;

notify pgrst, 'reload schema';
