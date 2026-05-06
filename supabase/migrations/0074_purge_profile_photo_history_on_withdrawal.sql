-- 회원 탈퇴 시 profile_photo_history 전 행 삭제(Storage 객체는 앱이 avatars 정책으로 remove — 0071과 동일)

create or replace function public.purge_profile_photo_history_for_user(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text := nullif(trim(p_app_user_id), '');
begin
  if v_user_id is null then
    raise exception 'app_user_id required';
  end if;

  delete from public.profile_photo_history
  where app_user_id = v_user_id;
end;
$$;

revoke all on function public.purge_profile_photo_history_for_user(text) from public;
grant execute on function public.purge_profile_photo_history_for_user(text) to anon, authenticated;

notify pgrst, 'reload schema';
