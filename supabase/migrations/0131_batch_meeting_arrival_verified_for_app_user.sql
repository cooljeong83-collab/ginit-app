-- 홈 도착 인증 배너용: 여러 모임 ID에 대한 현재 사용자 인증 여부를 한 번의 RPC로 조회합니다.
-- 단건 RPC와 동일하게 app_user_id로 프로필을 해석해 RLS 가시성 차이를 피합니다.

create or replace function public.list_meeting_arrival_verified_meeting_ids_for_app_user(
  p_meeting_ids uuid[],
  p_app_user_id text
)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with target_profile as (
    select p.id
    from public.profiles p
    where p.app_user_id = trim(p_app_user_id)
      and p.is_withdrawn is not true
    limit 1
  )
  select coalesce(array_agg(distinct v.meeting_id), '{}'::uuid[])
  from public.meeting_arrival_verifications v
  join target_profile tp on tp.id = v.profile_id
  where p_meeting_ids is not null
    and coalesce(array_length(p_meeting_ids, 1), 0) > 0
    and p_app_user_id is not null
    and trim(p_app_user_id) <> ''
    and v.meeting_id = any(p_meeting_ids);
$$;

revoke all on function public.list_meeting_arrival_verified_meeting_ids_for_app_user(uuid[], text) from public;
grant execute on function public.list_meeting_arrival_verified_meeting_ids_for_app_user(uuid[], text) to anon, authenticated;

notify pgrst, 'reload schema';
