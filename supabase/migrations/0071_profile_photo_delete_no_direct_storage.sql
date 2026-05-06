-- Supabase: storage.objects 직접 DELETE 금지 → Storage API(클라이언트 remove) 사용
-- DB 이력·프로필 URL 정리만 RPC에서 수행

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

  delete from public.profile_photo_history
  where app_user_id = v_user_id
    and photo_url = v_url;

  update public.profiles
  set
    photo_url = null,
    updated_at = now()
  where app_user_id = v_user_id
    and photo_url = v_url;
end;
$$;

revoke all on function public.delete_profile_photo_history_url(text, text) from public;
grant execute on function public.delete_profile_photo_history_url(text, text) to anon, authenticated;

-- meeting_chat 과 동일: anon/authenticated 가 Storage API로 삭제할 수 있게 함 (업로드가 열려 있는 버킷과 정책 정렬)
drop policy if exists avatars_delete_open on storage.objects;
create policy avatars_delete_open
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'avatars');

notify pgrst, 'reload schema';
