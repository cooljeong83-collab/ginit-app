-- 피드 후기 캐러셀: 지역별 증분 동기화(change summaries + id 상세 fetch)

create index if not exists meeting_reviews_created_at_id_idx
  on public.meeting_reviews (created_at asc, id asc);

create index if not exists meetings_public_feed_region_created_idx
  on public.meetings (feed_region_norm, id)
  where is_public = true
    and feed_region_norm is not null
    and length(trim(feed_region_norm)) > 0;

-- 지역·워터마크 이후 신규/변경 후기 요약(created_at 기준)
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
    and trim(m.feed_region_norm) = trim(p_region_norm)
    and m.is_public is true
    and public.meeting_review_is_settled(m.id)
    and r.comment is not null
    and trim(r.comment) <> ''
    and p_last_sync_at is not null
    and r.created_at > p_last_sync_at
  order by r.created_at asc, r.id asc
  limit greatest(1, least(200, coalesce(p_limit, 100)));
$$;

revoke all on function public.list_feed_meeting_review_change_summaries(text, timestamptz, int) from public;
grant execute on function public.list_feed_meeting_review_change_summaries(text, timestamptz, int) to anon, authenticated;

-- 변경 id 목록 → 캐러셀 카드 payload
create or replace function public.get_feed_meeting_reviews_for_sync_by_ids(
  p_review_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if p_review_ids is null or cardinality(p_review_ids) = 0 then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'review_id', x.review_id,
        'meeting_id', x.meeting_id,
        'place_name', x.place_name,
        'rating', x.rating,
        'comment', x.comment,
        'created_at', x.created_at,
        'photo_url', x.photo_url,
        'region_norm', x.region_norm
      )
      order by x.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      r.id::text as review_id,
      r.meeting_id::text as meeting_id,
      coalesce(
        nullif(trim(m.place_name), ''),
        nullif(trim(m.extra_data->'fs'->>'placeName'), ''),
        nullif(trim(m.extra_data->>'placeName'), ''),
        '장소'
      ) as place_name,
      r.rating::int as rating,
      r.comment as comment,
      r.created_at as created_at,
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
      nullif(trim(m.feed_region_norm), '') as region_norm
    from public.meeting_reviews r
    inner join public.meetings m on m.id = r.meeting_id
    where r.id = any (p_review_ids)
      and m.is_public is true
      and public.meeting_review_is_settled(m.id)
      and r.comment is not null
      and trim(r.comment) <> ''
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.get_feed_meeting_reviews_for_sync_by_ids(uuid[]) from public;
grant execute on function public.get_feed_meeting_reviews_for_sync_by_ids(uuid[]) to anon, authenticated;
