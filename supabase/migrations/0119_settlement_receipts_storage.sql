-- 정산 영수증 썸네일: Storage(settlement_receipts), 공개 읽기 + anon/authenticated 업로드·삭제(앱이 anon 키 사용)
-- 클라이언트에서 JPEG로 압축 후 업로드(정책은 image/jpeg만 허용)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'settlement_receipts',
  'settlement_receipts',
  true,
  2097152,
  array['image/jpeg', 'image/jpg']::text[]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = coalesce(excluded.file_size_limit, 2097152),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, array['image/jpeg', 'image/jpg']::text[]);

drop policy if exists settlement_receipts_select_public on storage.objects;
create policy settlement_receipts_select_public
on storage.objects for select
using (bucket_id = 'settlement_receipts');

drop policy if exists settlement_receipts_insert_open on storage.objects;
create policy settlement_receipts_insert_open
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'settlement_receipts');

drop policy if exists settlement_receipts_delete_open on storage.objects;
create policy settlement_receipts_delete_open
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'settlement_receipts');
