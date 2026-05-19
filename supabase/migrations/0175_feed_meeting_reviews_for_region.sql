-- 피드 탐색: 관심 지역별 최신 모임 장소 후기 캐러셀용 목록 RPC

create or replace function public.list_feed_meeting_reviews_for_region(
  p_region_norm text,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_region text := nullif(trim(coalesce(p_region_norm, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 30);
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
    where m.is_public is true
      and public.meeting_review_is_settled(m.id)
      and nullif(trim(m.feed_region_norm), '') is not null
      and trim(m.feed_region_norm) = v_region
      and r.comment is not null
      and trim(r.comment) <> ''
    order by r.created_at desc
    limit v_limit
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.list_feed_meeting_reviews_for_region(text, int) from public;
grant execute on function public.list_feed_meeting_reviews_for_region(text, int) to anon, authenticated;

create index if not exists meeting_reviews_feed_region_created_idx
  on public.meeting_reviews (created_at desc);
