-- delete_profile_photo_history_url: 히스토리 행 삭제 + (해당 시) avatars Storage 객체 삭제
create or replace function public.delete_profile_photo_history_url(p_app_user_id text, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id text := nullif(trim(p_app_user_id), '');
  v_url text := nullif(trim(p_photo_url), '');
  v_seg text;
  v_prefix text;
  v_storage_path text;
  v_clean text;
  n_parts int;
begin
  if v_user_id is null then
    raise exception 'app_user_id required';
  end if;
  if v_url is null then
    raise exception 'photo_url required';
  end if;

  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- 업로드 경로 규칙과 동일: users/<storageSafeUserFolderSegment(app_user_id)>/<file>
  v_seg := replace(v_user_id, '/', '_');
  v_prefix := 'users/' || v_seg || '/';

  v_storage_path := null;
  if v_url ~* '/storage/v1/object/public/avatars/' then
    v_clean := regexp_replace(v_url, '^.*\/storage\/v1\/object\/public\/avatars\/', '', 'i');
    v_clean := split_part(split_part(v_clean, '?', 1), '#', 1);
    v_clean := trim(both '/' from v_clean);
    if v_clean is not null and v_clean <> '' then
      v_storage_path := v_clean;
    end if;
  end if;

  if v_storage_path is not null then
    if v_storage_path ~ '\.\.' then
      raise exception 'invalid object path';
    end if;
    n_parts := cardinality(string_to_array(v_storage_path, '/'));
    if n_parts <> 3 then
      raise exception 'invalid object path';
    end if;
    if left(v_storage_path, length(v_prefix)) is distinct from v_prefix then
      raise exception 'forbidden';
    end if;

    delete from storage.objects
    where bucket_id = 'avatars'
      and name = v_storage_path;
  end if;

  delete from public.profile_photo_history
  where app_user_id = v_user_id
    and photo_url = v_url;

  -- 현재 프로필이 같은 URL을 가리키면 비움(호출 순서와 무관하게 방어)
  update public.profiles
  set
    photo_url = null,
    updated_at = now()
  where app_user_id = v_user_id
    and photo_url = v_url;
end;
$$;

revoke all on function public.delete_profile_photo_history_url(text, text) from public;
grant execute on function public.delete_profile_photo_history_url(text, text) to authenticated;

notify pgrst, 'reload schema';
