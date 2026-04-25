-- 모임 채팅 이미지: Storage(meeting_chat), 공개 읽기 + anon/authenticated 업로드·삭제(앱이 anon 키 사용)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting_chat',
  'meeting_chat',
  true,
  5242880,
  array['image/jpeg', 'image/jpg']::text[]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = coalesce(excluded.file_size_limit, 5242880),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, array['image/jpeg', 'image/jpg']::text[]);

drop policy if exists meeting_chat_select_public on storage.objects;
create policy meeting_chat_select_public
on storage.objects for select
using (bucket_id = 'meeting_chat');

drop policy if exists meeting_chat_insert_open on storage.objects;
create policy meeting_chat_insert_open
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'meeting_chat');

drop policy if exists meeting_chat_delete_open on storage.objects;
create policy meeting_chat_delete_open
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'meeting_chat');
