-- 내 모임(호스트/게스트 탭)용: 공개/비공개 포함 전체 목록
-- 클라이언트: supabase.rpc('ledger_list_my_meetings_for_feed', { p_app_user_id })
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
    where pr.app_user_id = trim(p_app_user_id)
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
  ),
  enriched as (
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
            jsonb_build_object(
              'createdBy',
              coalesce(nullif(trim(ph.app_user_id), ''), null),
              'participantIds',
              coalesce(
                (
                  select jsonb_agg(x.uid)
                  from (
                    select distinct nullif(trim(pr2.app_user_id), '') as uid
                    from public.meeting_participants mp2
                    inner join public.profiles pr2 on pr2.id = mp2.profile_id
                    where mp2.meeting_id = m.id
                      and pr2.app_user_id is not null
                  ) x
                  where x.uid is not null
                ),
                '[]'::jsonb
              )
            )
          )
        else
          jsonb_set(
            m.extra_data,
            '{fs}',
            coalesce(m.extra_data->'fs', '{}'::jsonb) ||
              jsonb_build_object(
                'createdBy',
                coalesce(nullif(trim(ph.app_user_id), ''), null),
                'participantIds',
                coalesce(
                  (
                    select jsonb_agg(x.uid)
                    from (
                      select distinct nullif(trim(pr2.app_user_id), '') as uid
                      from public.meeting_participants mp2
                      inner join public.profiles pr2 on pr2.id = mp2.profile_id
                      where mp2.meeting_id = m.id
                        and pr2.app_user_id is not null
                    ) x
                    where x.uid is not null
                  ),
                  '[]'::jsonb
                )
              ),
            true
          )
      end as extra_data,
      m.created_at,
      m.updated_at
    from mine m
    left join public.profiles ph on ph.id = m.created_by_profile_id
  )
  select *
  from enriched
  order by created_at desc
  limit 400;
$$;

revoke all on function public.ledger_list_my_meetings_for_feed(text) from public;
grant execute on function public.ledger_list_my_meetings_for_feed(text) to anon, authenticated;

notify pgrst, 'reload schema';

