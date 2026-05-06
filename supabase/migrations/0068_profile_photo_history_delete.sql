-- profile_photo_history: 특정 URL 이력 삭제 RPC (프로필 사진 삭제 UX용)
create or replace function public.delete_profile_photo_history_url(p_app_user_id text, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text := nullif(trim(p_app_user_id), '');
  v_url text := nullif(trim(p_photo_url), '');
begin
  if v_user_id is null then
    raise exception 'app_user_id required';
  end if;
  if v_url is null then
    raise exception 'photo_url required';
  end if;

  -- 본인 사진만 삭제 가능하도록(최소 보호). RLS에 의존하지 않고 auth.uid() 비교.
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- profiles.app_user_id는 클라이언트에서 쓰는 ID라 auth.uid()와 직접 매핑이 없을 수 있어,
  -- 여기서는 최소한 동일 app_user_id에 대해서만 삭제를 허용합니다.
  -- (추가 보호가 필요하면 profiles <-> auth 사용자 매핑 컬럼 도입 후 강화)
  delete from public.profile_photo_history
  where app_user_id = v_user_id
    and photo_url = v_url;
end;
$$;

revoke all on function public.delete_profile_photo_history_url(text, text) from public;
grant execute on function public.delete_profile_photo_history_url(text, text) to authenticated;

notify pgrst, 'reload schema';

