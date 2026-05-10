-- 모임 상세 참여자 카드용: 동일 모임 소속(또는 호스트)만, 장소 인증 완료한 참가자의 app_user_id 목록을 조회합니다.
-- RLS로는 타인 인증 행이 안 보일 수 있어 security definer RPC로 제공합니다.

create or replace function public.list_meeting_arrival_verified_app_user_ids(
  p_meeting_id uuid,
  p_viewer_app_user_id text
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer_profile_id uuid;
  v_host_id uuid;
  v_confirmed boolean;
  v_ids text[];
begin
  if p_meeting_id is null or p_viewer_app_user_id is null or trim(p_viewer_app_user_id) = '' then
    return '{}'::text[];
  end if;

  select p.id
  into v_viewer_profile_id
  from public.profiles p
  where p.app_user_id = trim(p_viewer_app_user_id)
    and coalesce(p.is_withdrawn, false) is not true
  limit 1;

  if v_viewer_profile_id is null then
    return '{}'::text[];
  end if;

  select m.created_by_profile_id, coalesce(m.schedule_confirmed, false)
  into v_host_id, v_confirmed
  from public.meetings m
  where m.id = p_meeting_id
  limit 1;

  if not found then
    return '{}'::text[];
  end if;

  if v_confirmed is not true then
    return '{}'::text[];
  end if;

  if not exists (
    select 1
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.profile_id = v_viewer_profile_id
  )
  and not (v_host_id is not null and v_host_id = v_viewer_profile_id) then
    return '{}'::text[];
  end if;

  select coalesce(
    array_agg(distinct trim(p.app_user_id)) filter (where length(trim(p.app_user_id)) > 0),
    '{}'::text[]
  )
  into v_ids
  from public.meeting_arrival_verifications v
  inner join public.profiles p on p.id = v.profile_id
  where v.meeting_id = p_meeting_id
    and coalesce(p.is_withdrawn, false) is not true;

  return coalesce(v_ids, '{}'::text[]);
end;
$$;

revoke all on function public.list_meeting_arrival_verified_app_user_ids(uuid, text) from public;
grant execute on function public.list_meeting_arrival_verified_app_user_ids(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
