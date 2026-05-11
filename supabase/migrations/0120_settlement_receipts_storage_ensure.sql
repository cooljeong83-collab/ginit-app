-- 정산 영수증 버킷: 0119와 동일(idempotent). 일부 원격 프로젝트에 0119 미적용 시에도 `supabase db push`로 생성되도록 재보장합니다.
-- 앱은 `settlement_receipts` 우선 업로드 후, 버킷 부재 시 `meeting_chat/settlement_receipts/...` 폴백을 사용합니다.

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
