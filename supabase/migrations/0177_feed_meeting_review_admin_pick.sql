-- 피드 후기 캐러셀: 관리자 픽 우선 노출(최대 5건, 픽 다수 시 무작위)

alter table public.meeting_reviews
  add column if not exists admin_pick boolean not null default false,
  add column if not exists admin_picked_at timestamptz;

comment on column public.meeting_reviews.admin_pick is
  '피드 탐색 후기 캐러셀 관리자 추천. true면 해당 지역 노출 시 우선(복수 건은 무작위).';
comment on column public.meeting_reviews.admin_picked_at is
  'admin_pick 토글 시각 — 증분 동기화 워터마크·픽 변경 감지용.';

create index if not exists meeting_reviews_admin_pick_idx
  on public.meeting_reviews (admin_pick)
  where admin_pick is true;

-- service_role 전용 — 대시보드·스크립트에서 픽 설정
create or replace function public.set_meeting_review_admin_pick(
  p_review_id uuid,
  p_admin_pick boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  update public.meeting_reviews
  set
    admin_pick = coalesce(p_admin_pick, false),
    admin_picked_at = case when coalesce(p_admin_pick, false) then now() else null end
  where id = p_review_id;

  if not found then
    raise exception 'review_not_found';
  end if;
end;
$$;

revoke all on function public.set_meeting_review_admin_pick(uuid, boolean) from public;
grant execute on function public.set_meeting_review_admin_pick(uuid, boolean) to service_role;

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
        'comment', x.comment,
        'created_at', x.created_at,
        'photo_url', x.photo_url,
        'region_norm', x.region_norm,
        'admin_pick', x.admin_pick
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
        nullif(trim(m.feed_region_norm), '') as region_norm
      from public.meeting_reviews r
      inner join public.meetings m on m.id = r.meeting_id
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
      c.comment,
      c.created_at,
      c.photo_url,
      c.region_norm,
      c.admin_pick,
      c.bucket,
      c.pick_ord
    from combined c
  ) x;

  return v_rows;
end;
$$;

revoke all on function public.list_feed_meeting_reviews_for_region(text, int) from public;
grant execute on function public.list_feed_meeting_reviews_for_region(text, int) to anon, authenticated;

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
    md5(
      concat(
        floor(extract(epoch from r.created_at) * 1000)::bigint::text,
        ':',
        case when coalesce(r.admin_pick, false) then '1' else '0' end,
        ':',
        coalesce(
          floor(extract(epoch from coalesce(r.admin_picked_at, r.created_at)) * 1000)::bigint::text,
          ''
        )
      )
    ) as updated_fp
  from public.meeting_reviews r
  inner join public.meetings m on m.id = r.meeting_id
  where nullif(trim(coalesce(p_region_norm, '')), '') is not null
    and trim(m.feed_region_norm) = trim(p_region_norm)
    and m.is_public is true
    and public.meeting_review_is_settled(m.id)
    and r.comment is not null
    and trim(r.comment) <> ''
    and p_last_sync_at is not null
    and (
      r.created_at > p_last_sync_at
      or coalesce(r.admin_picked_at, r.created_at) > p_last_sync_at
    )
  order by greatest(r.created_at, coalesce(r.admin_picked_at, r.created_at)) asc, r.id asc
  limit greatest(1, least(200, coalesce(p_limit, 100)));
$$;

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
        'region_norm', x.region_norm,
        'admin_pick', x.admin_pick
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
      nullif(trim(m.feed_region_norm), '') as region_norm,
      coalesce(r.admin_pick, false) as admin_pick
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

revoke all on function public.list_feed_meeting_review_change_summaries(text, timestamptz, int) from public;
grant execute on function public.list_feed_meeting_review_change_summaries(text, timestamptz, int) to anon, authenticated;
