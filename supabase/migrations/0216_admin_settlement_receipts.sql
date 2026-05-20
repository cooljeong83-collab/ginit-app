-- Admin settlement receipts: cursor list (5/page) + detail

create or replace function public.admin_list_settlement_receipts(
  p_limit int default 5,
  p_cursor timestamptz default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 20));
  v_items jsonb;
  v_next timestamptz;
  v_raw_count int;
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      s.id,
      s.meeting_id,
      s.receipt_id,
      s.uploader_app_user_id,
      s.amount_won,
      s.store_name,
      s.biz_num,
      s.is_verified,
      s.status,
      s.created_at,
      s.updated_at,
      coalesce(nullif(trim(m.title), ''), '모임') as meeting_title
    from public.settlement_receipt_analyses s
    left join public.meetings m
      on m.id::text = s.meeting_id
      or m.legacy_firestore_id = s.meeting_id
    where (p_cursor is null or s.updated_at < p_cursor)
      and (
        v_q is null
        or s.store_name ilike '%' || v_q || '%'
        or s.biz_num ilike '%' || v_q || '%'
        or s.uploader_app_user_id ilike '%' || v_q || '%'
        or s.meeting_id ilike '%' || v_q || '%'
        or coalesce(m.title, '') ilike '%' || v_q || '%'
      )
    order by s.updated_at desc
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'updated_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'updated_at') desc), '[]'::jsonb)
      from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      where ord <= v_limit
    );
  else
    v_next := null;
  end if;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next
  );
end;
$$;

revoke all on function public.admin_list_settlement_receipts(int, timestamptz, text) from public;
grant execute on function public.admin_list_settlement_receipts(int, timestamptz, text) to authenticated;

create or replace function public.admin_get_settlement_receipt(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.settlement_receipt_analyses%rowtype;
  v_meeting_title text;
begin
  perform public.assert_current_user_admin();

  select * into v_row
  from public.settlement_receipt_analyses s
  where s.id = p_id;

  if not found then
    raise exception 'not_found';
  end if;

  select coalesce(nullif(trim(m.title), ''), '모임')
  into v_meeting_title
  from public.meetings m
  where m.id::text = v_row.meeting_id
     or m.legacy_firestore_id = v_row.meeting_id
  limit 1;

  return jsonb_build_object(
    'id', v_row.id,
    'meeting_id', v_row.meeting_id,
    'receipt_id', v_row.receipt_id,
    'uploader_app_user_id', v_row.uploader_app_user_id,
    'image_url', v_row.image_url,
    'amount_won', v_row.amount_won,
    'analysis', v_row.analysis,
    'biz_num', v_row.biz_num,
    'store_name', v_row.store_name,
    'receipt_date_text', v_row.receipt_date_text,
    'calculated_total', v_row.calculated_total,
    'actual_payment', v_row.actual_payment,
    'is_verified', v_row.is_verified,
    'status', v_row.status,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'meeting_title', v_meeting_title
  );
end;
$$;

revoke all on function public.admin_get_settlement_receipt(uuid) from public;
grant execute on function public.admin_get_settlement_receipt(uuid) to authenticated;

notify pgrst, 'reload schema';
