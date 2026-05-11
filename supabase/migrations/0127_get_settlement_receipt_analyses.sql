-- 정산 완료 확인 화면에서 영수증 이미지와 OCR JSON 요약을 함께 표시하기 위한 읽기 RPC.

create or replace function public.get_settlement_receipt_analyses(
  p_meeting_id text
)
returns table (
  receipt_id text,
  image_url text,
  amount_won integer,
  analysis jsonb,
  biz_num text,
  store_name text,
  receipt_date_text text,
  actual_payment integer,
  is_verified boolean,
  status text
)
language sql
security definer
set search_path = public
as $$
  select
    sra.receipt_id,
    sra.image_url,
    sra.amount_won,
    sra.analysis,
    sra.biz_num,
    sra.store_name,
    sra.receipt_date_text,
    sra.actual_payment,
    sra.is_verified,
    sra.status
  from public.settlement_receipt_analyses sra
  where sra.meeting_id = nullif(trim(coalesce(p_meeting_id, '')), '')
    and sra.status in ('active', 'vendor_verified', 'vendor_rejected')
  order by sra.updated_at asc, sra.receipt_id asc;
$$;

revoke all on function public.get_settlement_receipt_analyses(text) from public;
grant execute on function public.get_settlement_receipt_analyses(text) to anon, authenticated;

notify pgrst, 'reload schema';
