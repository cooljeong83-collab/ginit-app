-- 프로필 사진: Storage(avatars) + profiles.photo_url
-- 앱은 Firebase Auth를 쓰므로 RLS(auth.uid) 직접 UPDATE 대신 RPC로 반영합니다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/jpg']::text[]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = coalesce(excluded.file_size_limit, 5242880),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, array['image/jpeg', 'image/jpg']::text[]);

drop policy if exists avatars_select_public on storage.objects;
create policy avatars_select_public
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists avatars_insert_open on storage.objects;
create policy avatars_insert_open
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'avatars');

create or replace function public.set_profile_photo_url(
  p_app_user_id text,
  p_photo_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(trim(p_photo_url), '');
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;
  if v_url is null then
    raise exception 'photo_url required';
  end if;
  if length(v_url) > 2048 then
    raise exception 'photo_url too long';
  end if;

  insert into public.profiles (app_user_id, nickname, photo_url)
  values (trim(p_app_user_id), '회원', v_url)
  on conflict (app_user_id) do update
  set
    photo_url = excluded.photo_url,
    updated_at = now();
end;
$$;

revoke all on function public.set_profile_photo_url(text, text) from public;
grant execute on function public.set_profile_photo_url(text, text) to anon, authenticated;
