-- Notices: explicit image-only flag (popup / detail can show image without title·content).
-- Depends on 0225, 0227, 0228. Additive.

alter table public.notices
  add column if not exists is_image_only boolean not null default false;

alter table public.notices drop constraint if exists notices_image_only_requires_image;
alter table public.notices add constraint notices_image_only_requires_image check (
  is_image_only is not true or nullif(trim(coalesce(image_url, '')), '') is not null
);

-- ---------------------------------------------------------------------------
-- admin_create_notice
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_notice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_notice_id uuid;
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
  v_scope text := coalesce(nullif(trim(coalesce(p_payload->>'target_scope', '')), ''), 'all');
  v_region text := public.normalize_announcement_region_norm(p_payload->>'target_region_norm');
  v_profile_id uuid := nullif(trim(coalesce(p_payload->>'target_profile_id', '')), '')::uuid;
  v_inbox_inserted int := 0;
  v_fcm_ids text[];
  v_target_exists boolean;
begin
  perform public.assert_current_user_admin();

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
  if v_scope not in ('all', 'region', 'admin_preview', 'user') then
    raise exception 'invalid_target_scope';
  end if;
  if v_scope = 'region' and v_region is null then
    raise exception 'region_required';
  end if;
  if v_scope = 'user' then
    if v_profile_id is null then
      raise exception 'user_required';
    end if;
    select exists(
      select 1
      from public.profiles p
      where p.id = v_profile_id
        and p.is_withdrawn is not true
        and p.app_user_id is not null
    )
    into v_target_exists;
    if not coalesce(v_target_exists, false) then
      raise exception 'user_not_found';
    end if;
  else
    v_profile_id := null;
  end if;

  select id into v_actor from public.profiles where auth_user_id = auth.uid() limit 1;

  insert into public.notices (
    title,
    content,
    link_url,
    image_url,
    is_home_banner,
    is_popup,
    is_push_alarm,
    is_image_only,
    start_at,
    end_at,
    target_scope,
    target_region_norm,
    target_profile_id,
    created_by_profile_id
  )
  values (
    v_title,
    v_content,
    v_link_url,
    v_image_url,
    v_is_home,
    v_is_popup,
    v_is_push,
    v_is_image_only,
    v_start_at,
    v_end_at,
    v_scope,
    v_region,
    v_profile_id,
    v_actor
  )
  returning id into v_notice_id;

  if v_scope = 'admin_preview' then
    if v_actor is not null then
      insert into public.user_notifications (profile_id, notice_id, is_read)
      values (v_actor, v_notice_id, false)
      on conflict (profile_id, notice_id) do nothing;
      get diagnostics v_inbox_inserted = row_count;
    end if;
  elsif v_scope = 'region' then
    insert into public.user_notifications (profile_id, notice_id, is_read)
    select p.id, v_notice_id, false
    from public.profiles p
    where p.is_withdrawn is not true
      and p.app_user_id is not null
      and public.normalize_announcement_region_norm(p.metadata->>'base_region') = v_region
    on conflict (profile_id, notice_id) do nothing;
    get diagnostics v_inbox_inserted = row_count;
  elsif v_scope = 'user' then
    insert into public.user_notifications (profile_id, notice_id, is_read)
    values (v_profile_id, v_notice_id, false)
    on conflict (profile_id, notice_id) do nothing;
    get diagnostics v_inbox_inserted = row_count;
  else
    insert into public.user_notifications (profile_id, notice_id, is_read)
    select p.id, v_notice_id, false
    from public.profiles p
    where p.is_withdrawn is not true
      and p.app_user_id is not null
    on conflict (profile_id, notice_id) do nothing;
    get diagnostics v_inbox_inserted = row_count;
  end if;

  if v_is_push then
    if v_scope = 'admin_preview' and v_actor is not null then
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.id = v_actor and p.app_user_id is not null;
    elsif v_scope = 'region' then
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.is_withdrawn is not true
        and p.app_user_id is not null
        and public.normalize_announcement_region_norm(p.metadata->>'base_region') = v_region;
    elsif v_scope = 'user' then
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.id = v_profile_id and p.app_user_id is not null;
    else
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.is_withdrawn is not true
        and p.app_user_id is not null;
    end if;

    begin
      perform private.admin_notice_send_fcm_batch(
        v_fcm_ids,
        coalesce(nullif(v_title, ''), '공지'),
        left(coalesce(v_content, ''), 200),
        v_notice_id,
        v_link_url
      );
    exception
      when others then
        raise notice 'admin_notice_send_fcm_batch failed: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'notice_id', v_notice_id,
    'inbox_inserted', v_inbox_inserted,
    'push_requested', v_is_push
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- App RPCs: expose is_image_only
-- ---------------------------------------------------------------------------
create or replace function public.list_active_notices_for_me(p_channel text default 'home_banner')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_profile uuid;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if v_channel not in ('home_banner', 'popup') then
    raise exception 'invalid_channel';
  end if;

  v_profile := public.current_profile_row_id();
  if v_profile is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(y)::jsonb order by y.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      n.id,
      n.title,
      n.content,
      n.link_url,
      n.image_url,
      n.is_home_banner,
      n.is_popup,
      n.is_image_only,
      n.start_at,
      n.end_at,
      n.target_scope,
      n.created_at,
      un.id as inbox_id,
      coalesce(un.is_read, false) as is_read
    from public.notices n
    inner join public.user_notifications un
      on un.notice_id = n.id
     and un.profile_id = v_profile
    where public.notice_visible_to_current_user(n)
      and (
        (v_channel = 'home_banner' and n.is_home_banner is true)
        or (v_channel = 'popup' and n.is_popup is true and n.image_url is not null)
      )
    order by n.created_at desc
    limit 10
  ) y;

  return coalesce(v_items, '[]'::jsonb);
end;
$$;

create or replace function public.list_my_notice_inbox(
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_profile uuid;
  v_items jsonb;
  v_next timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  v_profile := public.current_profile_row_id();
  if v_profile is null then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.inbox_created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      un.id as inbox_id,
      un.notice_id,
      un.is_read,
      un.created_at as inbox_created_at,
      n.title,
      n.content,
      n.link_url,
      n.image_url,
      n.is_home_banner,
      n.is_popup,
      n.is_push_alarm,
      n.is_image_only,
      n.start_at,
      n.end_at,
      n.target_scope,
      n.created_at as notice_created_at
    from public.user_notifications un
    inner join public.notices n on n.id = un.notice_id
    where un.profile_id = v_profile
      and public.notice_visible_to_current_user(n)
      and (p_cursor is null or un.created_at < p_cursor)
    order by un.created_at desc
    limit v_limit + 1
  ) x;

  select count(*)::int, min(t.inbox_created_at)
  into v_count, v_next
  from (
    select un.created_at as inbox_created_at
    from public.user_notifications un
    inner join public.notices n on n.id = un.notice_id
    where un.profile_id = v_profile
      and public.notice_visible_to_current_user(n)
      and (p_cursor is null or un.created_at < p_cursor)
    order by un.created_at desc
    limit v_limit + 1
  ) t;

  if v_count > v_limit then
    select min(inbox_created_at) into v_next
    from (
      select un.created_at as inbox_created_at
      from public.user_notifications un
      inner join public.notices n on n.id = un.notice_id
      where un.profile_id = v_profile
        and public.notice_visible_to_current_user(n)
        and (p_cursor is null or un.created_at < p_cursor)
      order by un.created_at desc
      limit v_limit + 1
    ) s;
    v_items := coalesce((
      select jsonb_agg(elem order by (elem->>'inbox_created_at')::timestamptz desc)
      from (
        select elem
        from jsonb_array_elements(v_items) elem
        limit v_limit
      ) z
    ), '[]'::jsonb);
  else
    v_next := null;
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

create or replace function public.get_notice_detail_for_me(p_notice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_row public.notices%rowtype;
  v_inbox_id uuid;
  v_is_read boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  if p_notice_id is null then
    raise exception 'notice_id_required';
  end if;

  v_profile := public.current_profile_row_id();
  if v_profile is null then
    raise exception 'not_found';
  end if;

  select * into v_row from public.notices where id = p_notice_id;
  if not found then
    raise exception 'not_found';
  end if;

  if not public.notice_visible_to_current_user(v_row) then
    raise exception 'not_found';
  end if;

  select un.id, un.is_read
  into v_inbox_id, v_is_read
  from public.user_notifications un
  where un.notice_id = p_notice_id
    and un.profile_id = v_profile
  limit 1;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'content', v_row.content,
    'link_url', v_row.link_url,
    'image_url', v_row.image_url,
    'is_home_banner', v_row.is_home_banner,
    'is_popup', v_row.is_popup,
    'is_push_alarm', v_row.is_push_alarm,
    'is_image_only', v_row.is_image_only,
    'start_at', v_row.start_at,
    'end_at', v_row.end_at,
    'target_scope', v_row.target_scope,
    'created_at', v_row.created_at,
    'inbox_id', v_inbox_id,
    'is_read', coalesce(v_is_read, false)
  );
end;
$$;

create or replace function public.admin_list_notices(
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
  from (
    select
      n.id,
      n.title,
      n.content,
      n.link_url,
      n.image_url,
      n.is_home_banner,
      n.is_popup,
      n.is_push_alarm,
      n.is_image_only,
      n.start_at,
      n.end_at,
      n.target_scope,
      n.target_region_norm,
      n.target_profile_id,
      tp.nickname as target_profile_nickname,
      tp.app_user_id as target_profile_app_user_id,
      n.created_at,
      (
        select count(*)::int
        from public.user_notifications un
        where un.notice_id = n.id
      ) as inbox_count
    from public.notices n
    left join public.profiles tp on tp.id = n.target_profile_id
    where p_cursor is null or n.created_at < p_cursor
    order by n.created_at desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

notify pgrst, 'reload schema';
