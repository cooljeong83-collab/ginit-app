-- 피드 후기 캐러셀 카드: 장소 주소·모임 평균 별점·참여자 요약

create or replace function public.feed_meeting_review_participant_stats(p_meeting_id uuid)
returns table (
  participant_first_name text,
  participant_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct public.ginit_normalize_app_user_id(trim(mp_src.app_user_id)) as norm_id
    from (
      select pr.app_user_id
      from public.meeting_participants mpart
      join public.profiles pr on pr.id = mpart.profile_id
      where mpart.meeting_id = p_meeting_id
        and pr.app_user_id is not null
        and btrim(pr.app_user_id) <> ''
      union
      select trim(pid.participant_id) as app_user_id
      from public.meetings m2
      cross join lateral jsonb_array_elements_text(
        coalesce(
          m2.extra_data->'fs'->'participantIds',
          m2.extra_data->'fs'->'participant_ids',
          '[]'::jsonb
        )
      ) as pid(participant_id)
      where m2.id = p_meeting_id
      union
      select pr2.app_user_id
      from public.meetings m3
      join public.profiles pr2 on pr2.id = m3.created_by_profile_id
      where m3.id = p_meeting_id
        and pr2.app_user_id is not null
        and btrim(pr2.app_user_id) <> ''
    ) mp_src
    where trim(mp_src.app_user_id) <> ''
  ),
  named as (
    select coalesce(nullif(btrim(p.nickname), ''), '회원') as display_name
    from ids
    left join public.profiles p
      on public.ginit_normalize_app_user_id(p.app_user_id) = ids.norm_id
    where ids.norm_id is not null
      and ids.norm_id <> ''
  )
  select
    (select n.display_name from named n order by n.display_name asc limit 1),
    coalesce((select count(*)::int from named), 0);
$$;

revoke all on function public.feed_meeting_review_participant_stats(uuid) from public;
grant execute on function public.feed_meeting_review_participant_stats(uuid) to anon, authenticated;

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
    with eligible as (
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
        nullif(trim(m.feed_region_norm), '') as region_norm,
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
        ps.participant_first_name,
        ps.participant_count
      from public.meeting_reviews r
      inner join public.meetings m on m.id = r.meeting_id
      left join lateral public.feed_meeting_review_participant_stats(m.id) ps on true
      where m.is_public is true
        and public.meeting_review_is_settled(m.id)
        and nullif(trim(m.feed_region_norm), '') is not null
        and trim(m.feed_region_norm) = v_region
        and r.comment is not null
        and trim(r.comment) <> ''
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
        0::double precision as pick_ord
      from eligible e
      where not exists (select 1 from picked p where p.id = e.id)
      order by e.created_at desc
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

revoke all on function public.list_feed_meeting_reviews_for_region(text, int) from public;
grant execute on function public.list_feed_meeting_reviews_for_region(text, int) to anon, authenticated;

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
        'avg_rating', x.avg_rating,
        'comment', x.comment,
        'created_at', x.created_at,
        'photo_url', x.photo_url,
        'region_norm', x.region_norm,
        'admin_pick', x.admin_pick,
        'location_label', x.location_label,
        'participant_first_name', x.participant_first_name,
        'participant_count', x.participant_count
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
      coalesce(
        (
          select round(avg(rav.rating)::numeric, 1)
          from public.meeting_reviews rav
          where rav.meeting_id = m.id
        ),
        r.rating::numeric
      ) as avg_rating,
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
      nullif(trim(m.feed_region_norm), '') as region_norm,
      coalesce(r.admin_pick, false) as admin_pick,
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
      ps.participant_first_name,
      ps.participant_count
    from public.meeting_reviews r
    inner join public.meetings m on m.id = r.meeting_id
    left join lateral public.feed_meeting_review_participant_stats(m.id) ps on true
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
