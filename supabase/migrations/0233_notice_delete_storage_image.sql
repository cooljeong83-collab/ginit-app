-- 공지 삭제 시 notice_bucket Storage 이미지도 제거.
-- Depends on 0225, 0230. Additive.

-- ---------------------------------------------------------------------------
-- Storage helper (security definer — RLS 우회, notice_bucket만)
-- ---------------------------------------------------------------------------
create or replace function private.delete_notice_bucket_image_url(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(trim(p_url), '');
  v_clean text;
begin
  if v_url is null then
    return;
  end if;

  if v_url !~* '/storage/v1/object/public/notice_bucket/' then
    return;
  end if;

  v_clean := regexp_replace(
    v_url,
    '^.*\/storage\/v1\/object\/public\/notice_bucket\/',
    '',
    'i'
  );
  v_clean := trim(both '/' from split_part(split_part(v_clean, '?', 1), '#', 1));

  if v_clean is null or v_clean = '' then
    return;
  end if;
  if v_clean ~ '\.\.' then
    raise exception 'invalid object path';
  end if;

  delete from storage.objects
  where bucket_id = 'notice_bucket'
    and name = v_clean;
end;
$$;

revoke all on function private.delete_notice_bucket_image_url(text) from public;

create or replace function private.delete_notice_bucket_assets_for_notice(
  p_notice_id uuid,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  if p_notice_id is null then
    return;
  end if;

  if nullif(trim(coalesce(p_image_url, '')), '') is not null then
    perform private.delete_notice_bucket_image_url(p_image_url);
  end if;

  v_prefix := 'notices/' || p_notice_id::text || '/';
  delete from storage.objects
  where bucket_id = 'notice_bucket'
    and (
      name = v_prefix
      or name like v_prefix || '%'
    );
end;
$$;

revoke all on function private.delete_notice_bucket_assets_for_notice(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- admin_delete_notice
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_notice(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_image_url text;
begin
  perform public.assert_current_user_admin();

  if p_id is null then
    raise exception 'notice_id_required';
  end if;

  select n.image_url into v_image_url
  from public.notices n
  where n.id = p_id;

  if not found then
    raise exception 'not_found';
  end if;

  perform private.delete_notice_bucket_assets_for_notice(p_id, v_image_url);

  delete from public.notices where id = p_id;

  return jsonb_build_object('deleted', true, 'notice_id', p_id);
end;
$$;

revoke all on function public.admin_delete_notice(uuid) from public;
grant execute on function public.admin_delete_notice(uuid) to authenticated;

notify pgrst, 'reload schema';
