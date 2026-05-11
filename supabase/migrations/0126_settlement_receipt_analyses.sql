-- 정산 영수증 OCR 분석 JSON 보관: 추후 업체 인증/검수에 재사용할 증빙 원장.
-- 앱 화면/공유용 `settlementInfo.draftReceipts`는 최소 스냅샷만 유지하고,
-- 이미지 URL + OCR 분석 JSON + 검증 요약은 이 테이블에 별도 저장합니다.

create table if not exists public.settlement_receipt_analyses (
  id uuid primary key default gen_random_uuid(),
  meeting_id text not null,
  receipt_id text not null,
  uploader_app_user_id text not null,
  image_url text not null,
  amount_won integer not null check (amount_won >= 0 and amount_won <= 500000000),
  analysis jsonb not null default '{}'::jsonb,
  biz_num text,
  store_name text,
  receipt_date_text text,
  calculated_total integer,
  actual_payment integer,
  is_verified boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive', 'vendor_verified', 'vendor_rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, receipt_id)
);

-- `create table if not exists`는 기존 테이블에 새 컬럼을 추가하지 않으므로,
-- 이전 버전으로 일부 적용된 환경에서도 아래 인덱스/RPC가 안전하게 재실행되도록 보강합니다.
alter table public.settlement_receipt_analyses
add column if not exists biz_num text;

create index if not exists settlement_receipt_analyses_meeting_idx
on public.settlement_receipt_analyses (meeting_id, status, updated_at desc);

create index if not exists settlement_receipt_analyses_uploader_idx
on public.settlement_receipt_analyses (uploader_app_user_id, updated_at desc);

create index if not exists settlement_receipt_analyses_store_idx
on public.settlement_receipt_analyses (store_name)
where store_name is not null and status = 'active';

create index if not exists settlement_receipt_analyses_biz_num_idx
on public.settlement_receipt_analyses (biz_num)
where biz_num is not null and status = 'active';

alter table public.settlement_receipt_analyses enable row level security;

revoke all on table public.settlement_receipt_analyses from public;
revoke all on table public.settlement_receipt_analyses from anon;
revoke all on table public.settlement_receipt_analyses from authenticated;

create or replace function public.sync_settlement_receipt_analyses(
  p_meeting_id text,
  p_uploader_app_user_id text,
  p_receipts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting_id text := nullif(trim(coalesce(p_meeting_id, '')), '');
  v_uploader text := nullif(trim(coalesce(p_uploader_app_user_id, '')), '');
  v_receipts jsonb := coalesce(p_receipts, '[]'::jsonb);
  v_item jsonb;
  v_receipt_id text;
  v_image_url text;
  v_amount_won integer;
  v_analysis jsonb;
  v_biz_num text;
  v_store_name text;
  v_receipt_date_text text;
  v_calculated_total integer;
  v_actual_payment integer;
  v_is_verified boolean;
  v_keep_ids text[] := array[]::text[];
  v_text text;
begin
  if v_meeting_id is null then
    raise exception 'meeting_id_required';
  end if;
  if v_uploader is null then
    raise exception 'uploader_app_user_id_required';
  end if;
  if jsonb_typeof(v_receipts) <> 'array' then
    raise exception 'receipts_must_be_array';
  end if;

  for v_item in select value from jsonb_array_elements(v_receipts)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      continue;
    end if;

    v_receipt_id := nullif(trim(coalesce(v_item->>'receipt_id', v_item->>'receiptId', v_item->>'id', '')), '');
    v_image_url := nullif(trim(coalesce(v_item->>'image_url', v_item->>'imageUrl', '')), '');
    v_text := nullif(trim(coalesce(v_item->>'amount_won', v_item->>'amountWon', '')), '');

    if v_receipt_id is null or v_image_url is null or v_text is null then
      continue;
    end if;
    if v_image_url !~* '^https?://' then
      continue;
    end if;
    if v_text !~ '^[0-9]+$' then
      continue;
    end if;

    v_amount_won := v_text::integer;
    if v_amount_won < 0 or v_amount_won > 500000000 then
      continue;
    end if;

    v_analysis := case
      when jsonb_typeof(v_item->'analysis') = 'object' then v_item->'analysis'
      else '{}'::jsonb
    end;

    v_text := regexp_replace(nullif(trim(coalesce(v_analysis#>>'{verification,biz_num}', '')), ''), '[^0-9]', '', 'g');
    v_biz_num := case
      when length(v_text) = 10 then substring(v_text from 1 for 3) || '-' || substring(v_text from 4 for 2) || '-' || substring(v_text from 6)
      else nullif(trim(coalesce(v_analysis#>>'{verification,biz_num}', '')), '')
    end;

    v_store_name := nullif(trim(coalesce(v_analysis#>>'{verification,store_name}', '')), '');
    v_receipt_date_text := nullif(trim(coalesce(v_analysis#>>'{verification,datetime}', '')), '');

    v_text := nullif(trim(coalesce(v_analysis#>>'{billing,total_amount}', '')), '');
    v_calculated_total := case when v_text ~ '^[0-9]+$' then v_text::integer else null end;

    v_text := nullif(trim(coalesce(v_analysis#>>'{billing,total_amount}', '')), '');
    v_actual_payment := case when v_text ~ '^[0-9]+$' then v_text::integer else null end;

    v_text := lower(nullif(trim(coalesce(v_analysis#>>'{billing,is_verified}', '')), ''));
    v_is_verified := coalesce(v_text in ('true', '1', 'yes'), false);
    v_keep_ids := array_append(v_keep_ids, v_receipt_id);

    insert into public.settlement_receipt_analyses (
      meeting_id,
      receipt_id,
      uploader_app_user_id,
      image_url,
      amount_won,
      analysis,
      biz_num,
      store_name,
      receipt_date_text,
      calculated_total,
      actual_payment,
      is_verified,
      status,
      updated_at
    )
    values (
      v_meeting_id,
      v_receipt_id,
      v_uploader,
      v_image_url,
      v_amount_won,
      v_analysis,
      v_biz_num,
      v_store_name,
      v_receipt_date_text,
      v_calculated_total,
      v_actual_payment,
      v_is_verified,
      'active',
      now()
    )
    on conflict (meeting_id, receipt_id) do update
    set
      uploader_app_user_id = excluded.uploader_app_user_id,
      image_url = excluded.image_url,
      amount_won = excluded.amount_won,
      analysis = case
        when excluded.analysis <> '{}'::jsonb then excluded.analysis
        else public.settlement_receipt_analyses.analysis
      end,
      biz_num = case
        when excluded.analysis <> '{}'::jsonb then excluded.biz_num
        else public.settlement_receipt_analyses.biz_num
      end,
      store_name = case
        when excluded.analysis <> '{}'::jsonb then excluded.store_name
        else public.settlement_receipt_analyses.store_name
      end,
      receipt_date_text = case
        when excluded.analysis <> '{}'::jsonb then excluded.receipt_date_text
        else public.settlement_receipt_analyses.receipt_date_text
      end,
      calculated_total = case
        when excluded.analysis <> '{}'::jsonb then excluded.calculated_total
        else public.settlement_receipt_analyses.calculated_total
      end,
      actual_payment = case
        when excluded.analysis <> '{}'::jsonb then excluded.actual_payment
        else public.settlement_receipt_analyses.actual_payment
      end,
      is_verified = case
        when excluded.analysis <> '{}'::jsonb then excluded.is_verified
        else public.settlement_receipt_analyses.is_verified
      end,
      status = case
        when public.settlement_receipt_analyses.status in ('vendor_verified', 'vendor_rejected') then public.settlement_receipt_analyses.status
        else 'active'
      end,
      updated_at = now();
  end loop;

  update public.settlement_receipt_analyses
  set
    status = 'inactive',
    updated_at = now()
  where meeting_id = v_meeting_id
    and uploader_app_user_id = v_uploader
    and status = 'active'
    and not (receipt_id = any(v_keep_ids));
end;
$$;

revoke all on function public.sync_settlement_receipt_analyses(text, text, jsonb) from public;
grant execute on function public.sync_settlement_receipt_analyses(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
