-- ledger_list_my_meetings_for_feed: meetings 행 전체 컬럼 반환 (venue_id 등 누락 시 PostgREST "return type mismatch").
-- 클라이언트 내 모임·비공개 참여중/종료 탭이 이 RPC에 의존한다.

create or replace function public.ledger_list_my_meetings_for_feed(p_app_user_id text)
returns setof public.meetings
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select pr.id as profile_id
    from public.profiles pr
    where nullif(trim(p_app_user_id), '') is not null
      and public.ginit_normalize_app_user_id(pr.app_user_id)
        = public.ginit_normalize_app_user_id(p_app_user_id)
    limit 1
  ),
  mine as (
    select m.*
    from public.meetings m
    where
      m.created_by_profile_id = (select profile_id from me)
      or exists (
        select 1
        from public.meeting_participants mp
        where mp.meeting_id = m.id
          and mp.profile_id = (select profile_id from me)
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
        jsonb_build_object(
          'fs',
          public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id)
        )
      else
        jsonb_set(
          m.extra_data,
          '{fs}',
          public.meeting_sync_enriched_fs(m.id, m.extra_data, m.created_by_profile_id),
          true
        )
    end as extra_data,
    m.created_at,
    m.updated_at,
    m.feed_region_norm,
    m.place_key,
    m.venue_id
  from mine m
  order by m.created_at desc
  limit 400;
$$;

revoke all on function public.ledger_list_my_meetings_for_feed(text) from public;
grant execute on function public.ledger_list_my_meetings_for_feed(text) to anon, authenticated;

notify pgrst, 'reload schema';
