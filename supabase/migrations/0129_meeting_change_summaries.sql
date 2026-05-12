-- Lightweight meeting sync summaries for cache-first list rendering.
-- Client flow: render persisted cache first, compare these summaries, then fetch changed IDs only.

create index if not exists meetings_public_created_updated_idx
  on public.meetings (is_public, created_at desc, updated_at desc);

create index if not exists meetings_public_geo_created_idx
  on public.meetings (is_public, category_id, created_at desc)
  where latitude is not null and longitude is not null;

create or replace function public.meeting_sync_enriched_fs(
  p_meeting_id uuid,
  p_extra_data jsonb,
  p_created_by_profile_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when coalesce(p_extra_data, '{}'::jsonb) ? 'fs' then p_extra_data->'fs'
      else '{}'::jsonb
    end,
    '{}'::jsonb
  ) || jsonb_build_object(
    'createdBy',
    coalesce(
      (
        select nullif(trim(ph.app_user_id), '')
        from public.profiles ph
        where ph.id = p_created_by_profile_id
        limit 1
      ),
      nullif(trim(coalesce(p_extra_data->'fs'->>'createdBy', '')), ''),
      null
    ),
    'participantIds',
    coalesce(
      (
        select jsonb_agg(x.uid order by x.uid)
        from (
          select distinct public.ginit_normalize_app_user_id(uid) as uid
          from (
            select jsonb_array_elements_text(coalesce(p_extra_data->'fs'->'participantIds', '[]'::jsonb)) as uid
            union all
            select pr.app_user_id as uid
            from public.meeting_participants mp
            inner join public.profiles pr on pr.id = mp.profile_id
            where mp.meeting_id = p_meeting_id
              and pr.app_user_id is not null
          ) src
        ) x
        where x.uid is not null and x.uid <> ''
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.meeting_sync_enriched_fs(uuid, jsonb, uuid) from public;
grant execute on function public.meeting_sync_enriched_fs(uuid, jsonb, uuid) to anon, authenticated;

create or replace function public.list_public_meeting_change_summaries(
  p_limit int default 400
)
returns table (
  meeting_id text,
  row_id uuid,
  updated_at timestamptz,
  participant_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text) as meeting_id,
    m.id as row_id,
    m.updated_at,
    public.meeting_share_distinct_participant_count(
      public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id)
    ) as participant_count,
    m.created_at
  from public.meetings m
  where m.is_public = true
  order by m.created_at desc
  limit greatest(1, least(400, coalesce(p_limit, 400)));
$$;

revoke all on function public.list_public_meeting_change_summaries(int) from public;
grant execute on function public.list_public_meeting_change_summaries(int) to anon, authenticated;

create or replace function public.list_my_meeting_change_summaries(
  p_app_user_id text
)
returns table (
  meeting_id text,
  row_id uuid,
  updated_at timestamptz,
  participant_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select pr.id as profile_id
    from public.profiles pr
    where public.ginit_normalize_app_user_id(pr.app_user_id) = public.ginit_normalize_app_user_id(p_app_user_id)
    limit 1
  )
  select
    coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text) as meeting_id,
    m.id as row_id,
    m.updated_at,
    public.meeting_share_distinct_participant_count(
      public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id)
    ) as participant_count,
    m.created_at
  from public.meetings m
  where
    m.created_by_profile_id = (select profile_id from me)
    or exists (
      select 1
      from public.meeting_participants mp
      where mp.meeting_id = m.id
        and mp.profile_id = (select profile_id from me)
    )
  order by m.created_at desc
  limit 400;
$$;

revoke all on function public.list_my_meeting_change_summaries(text) from public;
grant execute on function public.list_my_meeting_change_summaries(text) to anon, authenticated;

create or replace function public.list_public_meeting_geo_change_summaries(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 5,
  p_category_id text default null
)
returns table (
  meeting_id text,
  row_id uuid,
  updated_at timestamptz,
  participant_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text) as meeting_id,
    m.id as row_id,
    m.updated_at,
    public.meeting_share_distinct_participant_count(
      public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id)
    ) as participant_count,
    m.created_at
  from public.meetings m
  where m.is_public = true
    and m.latitude is not null
    and m.longitude is not null
    and (
      p_category_id is null
      or length(trim(p_category_id)) = 0
      or m.category_id = trim(p_category_id)
    )
    and (
      6371.0 * acos(
        least(
          1::double precision,
          greatest(
            -1::double precision,
            cos(radians(p_lat)) * cos(radians(m.latitude))
            * cos(radians(m.longitude) - radians(p_lng))
            + sin(radians(p_lat)) * sin(radians(m.latitude))
          )
        )
      )
    ) <= greatest(0.1::double precision, least(200.0::double precision, p_radius_km))
  order by m.created_at desc
  limit 400;
$$;

revoke all on function public.list_public_meeting_geo_change_summaries(double precision, double precision, double precision, text) from public;
grant execute on function public.list_public_meeting_geo_change_summaries(double precision, double precision, double precision, text) to anon, authenticated;

drop function if exists public.get_meetings_for_sync_by_ids(text[], text);

create or replace function public.get_meetings_for_sync_by_ids(
  p_meeting_ids text[],
  p_viewer_app_user_id text default null
)
returns table (
  id uuid,
  legacy_firestore_id text,
  title text,
  description text,
  capacity int,
  min_participants int,
  category_id text,
  category_label text,
  is_public boolean,
  image_url text,
  created_by_profile_id uuid,
  schedule_confirmed boolean,
  schedule_date text,
  schedule_time text,
  scheduled_at timestamptz,
  place_name text,
  address text,
  latitude double precision,
  longitude double precision,
  confirmed_date_chip_id text,
  confirmed_place_chip_id text,
  confirmed_movie_chip_id text,
  extra_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select distinct trim(x) as id_text
    from unnest(coalesce(p_meeting_ids, '{}'::text[])) as t(x)
    where trim(x) <> ''
  ),
  viewer as (
    select pr.id as profile_id
    from public.profiles pr
    where public.ginit_normalize_app_user_id(pr.app_user_id) = public.ginit_normalize_app_user_id(coalesce(p_viewer_app_user_id, ''))
    limit 1
  ),
  allowed as (
    select m.*
    from public.meetings m
    where exists (
        select 1
        from requested r
        where r.id_text = m.id::text
          or r.id_text = coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text)
      )
      and (
        m.is_public = true
        or m.created_by_profile_id = (select profile_id from viewer)
        or exists (
          select 1
          from public.meeting_participants mp
          where mp.meeting_id = m.id
            and mp.profile_id = (select profile_id from viewer)
        )
      )
  )
  select
    m.id,
    m.legacy_firestore_id,
    m.title,
    m.description,
    m.capacity,
    m.min_participants,
    m.category_id,
    m.category_label,
    m.is_public,
    m.image_url,
    m.created_by_profile_id,
    m.schedule_confirmed,
    m.schedule_date,
    m.schedule_time,
    m.scheduled_at,
    m.place_name,
    m.address,
    m.latitude,
    m.longitude,
    m.confirmed_date_chip_id,
    m.confirmed_place_chip_id,
    m.confirmed_movie_chip_id,
    case
      when (m.extra_data is null or jsonb_typeof(m.extra_data) <> 'object') then
        jsonb_build_object('fs', public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id))
      else
        jsonb_set(
          m.extra_data,
          '{fs}',
          public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id),
          true
        )
    end as extra_data,
    m.created_at,
    m.updated_at
  from allowed m
  order by m.created_at desc;
$$;

revoke all on function public.get_meetings_for_sync_by_ids(text[], text) from public;
grant execute on function public.get_meetings_for_sync_by_ids(text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
