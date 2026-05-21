-- Supabase: storage.objects 직접 DELETE 금지 → Storage API(관리자 앱 remove) 사용
-- 0233의 admin_delete_notice storage 삭제 제거. DB는 notices 행만 삭제.

drop function if exists private.delete_notice_bucket_assets_for_notice(uuid, text);
drop function if exists private.delete_notice_bucket_image_url(text);

create or replace function public.admin_delete_notice(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();

  delete from public.notices where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;

  return jsonb_build_object('deleted', true, 'notice_id', p_id);
end;
$$;

revoke all on function public.admin_delete_notice(uuid) from public;
grant execute on function public.admin_delete_notice(uuid) to authenticated;

notify pgrst, 'reload schema';
