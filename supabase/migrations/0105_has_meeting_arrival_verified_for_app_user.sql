-- 클라이언트가 `meeting_arrival_verifications`를 직접 SELECT할 때 RLS(auth_user_id 연동)로 행이 안 보이는 경우가 있어,
-- `verify_meeting_arrival_and_reward`와 동일하게 `app_user_id`로 프로필을 해석한 뒤 존재 여부만 반환합니다.

create or replace function public.has_meeting_arrival_verified_for_app_user(
  p_meeting_id uuid,
  p_app_user_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if p_meeting_id is null or p_app_user_id is null or trim(p_app_user_id) = '' then
    return false;
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where p.app_user_id = trim(p_app_user_id)
    and p.is_withdrawn is not true
  limit 1;

  if v_profile_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.meeting_arrival_verifications v
    where v.meeting_id = p_meeting_id
      and v.profile_id = v_profile_id
  );
end;
$$;

revoke all on function public.has_meeting_arrival_verified_for_app_user(uuid, text) from public;
grant execute on function public.has_meeting_arrival_verified_for_app_user(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
