-- Firebase Auth만 쓰는 클라이언트는 Supabase JWT가 없어 auth.uid()가 null이다.
-- upsert_profile_payload / list_profile_photo_history 와 동일하게 anon 에서 호출 가능하도록 맞춘다.
-- 보호: Storage 경로는 users/<replace(app_user_id,'/','_')>/... 만 삭제 허용.

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

notify pgrst, 'reload schema';
