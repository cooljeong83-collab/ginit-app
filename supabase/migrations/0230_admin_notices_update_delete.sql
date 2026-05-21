-- Admin notices: update master row, delete notice (+ inbox cascade).
-- Depends on 0225–0229. Additive.

-- ---------------------------------------------------------------------------
-- admin_update_notice
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_notice(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notices%rowtype;
  v_title text := nullif(trim(coalesce(p_payload->>'title', '')), '');
  v_content text := nullif(trim(coalesce(p_payload->>'content', '')), '');
  v_link_url text := nullif(trim(coalesce(p_payload->>'link_url', '')), '');
  v_image_url text := nullif(trim(coalesce(p_payload->>'image_url', '')), '');
  v_is_home boolean := coalesce((p_payload->>'is_home_banner')::boolean, false);
  v_is_popup boolean := coalesce((p_payload->>'is_popup')::boolean, false);
  v_is_push boolean := coalesce((p_payload->>'is_push_alarm')::boolean, false);
  v_is_image_only boolean := coalesce((p_payload->>'is_image_only')::boolean, false);
  v_start_at timestamptz := nullif(trim(coalesce(p_payload->>'start_at', '')), '')::timestamptz;
  v_end_at timestamptz := nullif(trim(coalesce(p_payload->>'end_at', '')), '')::timestamptz;
begin
  perform public.assert_current_user_admin();

  select * into v_row from public.notices where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;

  if v_is_image_only then
    if v_image_url is null then
      raise exception 'image_only_requires_image';
    end if;
    v_title := coalesce(v_title, '');
    v_content := coalesce(v_content, '');
  else
    if v_title is null then
      raise exception 'title_required';
    end if;
    if v_content is null then
      raise exception 'content_required';
    end if;
  end if;

  if v_is_popup and v_image_url is null then
    raise exception 'popup_requires_image';
  end if;
  if v_start_at is not null and v_end_at is not null and v_start_at > v_end_at then
    raise exception 'invalid_schedule_range';
  end if;

  update public.notices
  set
    title = v_title,
    content = v_content,
    link_url = v_link_url,
    image_url = v_image_url,
    is_home_banner = v_is_home,
    is_popup = v_is_popup,
    is_push_alarm = v_is_push,
    is_image_only = v_is_image_only,
    start_at = v_start_at,
    end_at = v_end_at,
    updated_at = now()
  where id = p_id;

  return jsonb_build_object('notice_id', p_id);
end;
$$;

revoke all on function public.admin_update_notice(uuid, jsonb) from public;
grant execute on function public.admin_update_notice(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_delete_notice
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- admin_get_notice (profile labels for edit UI)
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_notice(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.notices%rowtype;
  v_inbox int;
  v_nickname text;
  v_app_user_id text;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.notices where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;

  select count(*)::int into v_inbox
  from public.user_notifications un
  where un.notice_id = p_id;

  if v_row.target_profile_id is not null then
    select p.nickname, p.app_user_id
    into v_nickname, v_app_user_id
    from public.profiles p
    where p.id = v_row.target_profile_id;
  end if;

  return to_jsonb(v_row) || jsonb_build_object(
    'inbox_count', v_inbox,
    'target_profile_nickname', v_nickname,
    'target_profile_app_user_id', v_app_user_id
  );
end;
$$;

notify pgrst, 'reload schema';
