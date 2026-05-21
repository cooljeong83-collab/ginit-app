-- Admin notices: per-user target scope (target_profile_id).
-- Depends on 0225, 0227. Additive.

alter table public.notices
  add column if not exists target_profile_id uuid references public.profiles(id) on delete set null;

alter table public.notices drop constraint if exists notices_target_scope_check;
alter table public.notices add constraint notices_target_scope_check check (
  target_scope in ('all', 'region', 'admin_preview', 'user')
);

create or replace function public.notice_visible_to_current_user(n public.notices)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.notice_schedule_active(n)
    and (
      (
        n.target_scope = 'admin_preview'
        and public.is_current_user_admin()
      )
      or (
        n.target_scope <> 'admin_preview'
        and (
          n.target_scope = 'all'
          or (
            n.target_scope = 'region'
            and public.normalize_announcement_region_norm(n.target_region_norm) is not null
            and public.normalize_announcement_region_norm(n.target_region_norm)
              = public.current_profile_announcement_region_norm()
          )
          or (
            n.target_scope = 'user'
            and n.target_profile_id is not null
            and n.target_profile_id = public.current_profile_row_id()
          )
        )
      )
    );
$$;

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

  if v_title is null then
    raise exception 'title_required';
  end if;
  if v_content is null then
    raise exception 'content_required';
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
        v_title,
        left(v_content, 200),
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
