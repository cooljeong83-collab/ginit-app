-- Admin read-only ops: blocks, chat, settlements (additive)

create or replace function public.admin_list_user_blocks(p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'blocker_app_user_id', ub.blocker_app_user_id,
      'blocked_app_user_id', ub.blocked_app_user_id,
      'created_at', ub.created_at
    ) order by ub.created_at desc)
    from (select * from public.user_blocks order by created_at desc limit least(p_limit, 50)) ub
  ), '[]'::jsonb);
end; $$;
grant execute on function public.admin_list_user_blocks(int) to authenticated;

create or replace function public.admin_list_chat_rooms(p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cr.id,
      'is_group', cr.is_group,
      'updated_at', cr.updated_at
    ) order by cr.updated_at desc nulls last)
    from (
      select id, is_group, updated_at from public.chat_rooms
      order by updated_at desc nulls last limit least(p_limit, 50)
    ) cr
  ), '[]'::jsonb);
end; $$;
grant execute on function public.admin_list_chat_rooms(int) to authenticated;

create or replace function public.admin_list_settlement_receipts(p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'meeting_id', s.meeting_id,
      'created_at', s.created_at
    ) order by s.created_at desc)
    from (
      select id, meeting_id, created_at from public.settlement_receipt_analyses
      order by created_at desc limit least(p_limit, 50)
    ) s
  ), '[]'::jsonb);
end; $$;
grant execute on function public.admin_list_settlement_receipts(int) to authenticated;
