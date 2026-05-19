-- 탐색 피드 후기: 선택 지역 · 최근 7일 · 모임당 1카드 · 관리자 픽 우선 + 나머지 무작위(최대 5)
-- 작성자/참여자 필터 없음(security definer, 전체 공개 후기 풀)

create or replace function public.list_feed_meeting_reviews_for_region(
  p_region_norm text,
  p_limit int default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_region text := nullif(trim(coalesce(p_region_norm, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_since timestamptz := now() - interval '7 days';
  v_rows jsonb;
begin
  if v_region is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'review_id', x.review_id,
        'meeting_id', x.meeting_id,
        'place_name', x.place_name,
        'rating', x.rating,
        'avg_rating', x.avg_rating,
        'comment', x.comment,
        'comments', x.comments,
        'created_at', x.created_at,
        'photo_url', x.photo_url,
        'region_norm', x.region_norm,
        'admin_pick', x.admin_pick,
        'location_label', x.location_label,
        'participant_first_name', x.participant_first_name,
        'participant_count', x.participant_count
      )
      order by x.bucket asc, x.pick_ord asc, x.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    with review_rows as (
      select
        r.id,
        r.meeting_id,
        r.rating,
        r.comment,
        r.created_at,
        coalesce(r.admin_pick, false) as admin_pick,
        coalesce(
          nullif(trim(m.place_name), ''),
          nullif(trim(m.extra_data->'fs'->>'placeName'), ''),
          nullif(trim(m.extra_data->>'placeName'), ''),
          '장소'
        ) as place_name,
        coalesce(
          (
            select nullif(btrim(pc.elem->>'preferredPhotoMediaUrl'), '')
            from jsonb_array_elements(
              coalesce(
                m.extra_data->'fs'->'placeCandidates',
                m.extra_data->'place_candidates',
                '[]'::jsonb
              )
            ) as pc(elem)
            where nullif(btrim(pc.elem->>'preferredPhotoMediaUrl'), '') like 'https://%'
            limit 1
          ),
          (
            select nullif(btrim(pc.elem->>'preferred_photo_media_url'), '')
            from jsonb_array_elements(
              coalesce(
                m.extra_data->'fs'->'placeCandidates',
                m.extra_data->'place_candidates',
                '[]'::jsonb
              )
            ) as pc(elem)
            where nullif(btrim(pc.elem->>'preferred_photo_media_url'), '') like 'https://%'
            limit 1
          ),
          nullif(trim(m.image_url), '')
        ) as photo_url,
        coalesce(
          nullif(trim(m.feed_region_norm), ''),
          public.extract_gu_from_korean_address_text(public.meeting_location_haystack_for_feed_region(m))
        ) as region_norm,
        coalesce(
          nullif(trim(m.address), ''),
          nullif(trim(m.extra_data->'fs'->>'address'), ''),
          nullif(trim(m.extra_data->>'address'), ''),
          nullif(trim(m.extra_data->'fs'->>'location'), ''),
          nullif(trim(m.extra_data->>'location'), ''),
          nullif(trim(m.place_name), ''),
          nullif(trim(m.extra_data->'fs'->>'placeName'), ''),
          nullif(trim(m.extra_data->>'placeName'), '')
        ) as location_label,
        coalesce(
          (
            select round(avg(rav.rating)::numeric, 1)
            from public.meeting_reviews rav
            where rav.meeting_id = m.id
          ),
          r.rating::numeric
        ) as avg_rating,
        coalesce(
          (
            select jsonb_agg(mc.comment order by mc.created_at desc)
            from (
              select distinct on (btrim(mr.comment))
                btrim(mr.comment) as comment,
                mr.created_at
              from public.meeting_reviews mr
              where mr.meeting_id = m.id
                and mr.comment is not null
                and btrim(mr.comment) <> ''
              order by btrim(mr.comment), mr.created_at desc
            ) mc
          ),
          '[]'::jsonb
        ) as comments,
        ps.participant_first_name,
        ps.participant_count
      from public.meeting_reviews r
      inner join public.meetings m on m.id = r.meeting_id
      left join lateral public.feed_meeting_review_participant_stats(m.id) ps on true
      where m.is_public is true
        and public.meeting_review_is_settled(m.id)
        and public.meeting_matches_feed_region_for_reviews(m, v_region)
        and r.created_at >= v_since
        and r.comment is not null
        and trim(r.comment) <> ''
    ),
    eligible as (
      select distinct on (rr.meeting_id)
        rr.*
      from review_rows rr
      order by
        rr.meeting_id,
        rr.admin_pick desc,
        rr.created_at desc,
        rr.id desc
    ),
    picked as (
      select
        e.*,
        0 as bucket,
        random() as pick_ord
      from eligible e
      where e.admin_pick is true
      order by pick_ord
      limit v_limit
    ),
    pick_cnt as (
      select count(*)::int as n from picked
    ),
    rest as (
      select
        e.*,
        1 as bucket,
        random() as pick_ord
      from eligible e
      where not exists (select 1 from picked p where p.meeting_id = e.meeting_id)
      order by pick_ord
      limit greatest(0, v_limit - (select n from pick_cnt))
    ),
    combined as (
      select * from picked
      union all
      select * from rest
    )
    select
      c.id::text as review_id,
      c.meeting_id::text as meeting_id,
      c.place_name,
      c.rating::int as rating,
      c.avg_rating,
      c.comment,
      c.comments,
      c.created_at,
      c.photo_url,
      c.region_norm,
      c.admin_pick,
      c.location_label,
      c.participant_first_name,
      c.participant_count,
      c.bucket,
      c.pick_ord
    from combined c
  ) x;

  return v_rows;
end;
$$;

create or replace function public.list_feed_meeting_review_change_summaries(
  p_region_norm text,
  p_last_sync_at timestamptz,
  p_limit int default 100
)
returns table (
  review_id text,
  meeting_id text,
  created_at timestamptz,
  updated_fp text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id::text as review_id,
    r.meeting_id::text as meeting_id,
    r.created_at,
    md5((floor(extract(epoch from r.created_at) * 1000))::bigint::text) as updated_fp
  from public.meeting_reviews r
  inner join public.meetings m on m.id = r.meeting_id
  where nullif(trim(coalesce(p_region_norm, '')), '') is not null
    and public.meeting_matches_feed_region_for_reviews(m, trim(p_region_norm))
    and m.is_public is true
    and public.meeting_review_is_settled(m.id)
    and r.comment is not null
    and trim(r.comment) <> ''
    and r.created_at >= now() - interval '7 days'
    and p_last_sync_at is not null
    and r.created_at > p_last_sync_at
  order by r.created_at asc, r.id asc
  limit greatest(1, least(200, coalesce(p_limit, 100)));
$$;

create index if not exists meeting_reviews_created_at_desc_idx
  on public.meeting_reviews (created_at desc);

revoke all on function public.list_feed_meeting_reviews_for_region(text, int) from public;
grant execute on function public.list_feed_meeting_reviews_for_region(text, int) to anon, authenticated;

revoke all on function public.list_feed_meeting_review_change_summaries(text, timestamptz, int) from public;
grant execute on function public.list_feed_meeting_review_change_summaries(text, timestamptz, int) to anon, authenticated;

comment on function public.list_feed_meeting_reviews_for_region(text, int) is
  '탐색 피드 후기 캐러셀. 선택 지역·최근 7일·공개·정산완료·코멘트 있음. 모임당 1카드, admin_pick 우선(무작위) 후 나머지 무작위 최대 5. 작성자/참여 여부 무관.';
