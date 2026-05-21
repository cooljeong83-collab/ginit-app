-- App client: notices visibility + inbox RPCs (PART 2).
-- Depends on 0225 (notices, user_notifications). Additive.

create index if not exists notices_home_banner_active_idx
  on public.notices (created_at desc)
  where is_home_banner is true;

create index if not exists notices_popup_active_idx
  on public.notices (created_at desc)
  where is_popup is true and image_url is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_row_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_withdrawn is not true
  limit 1;
$$;

revoke all on function public.current_profile_row_id() from public;
grant execute on function public.current_profile_row_id() to authenticated;

create or replace function public.notice_schedule_active(n public.notices)
returns boolean
language sql
immutable
as $$
  select
    (n.start_at is null or n.start_at <= now())
    and (n.end_at is null or n.end_at > now());
$$;

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
        )
      )
    );
$$;

revoke all on function public.notice_visible_to_current_user(public.notices) from public;
grant execute on function public.notice_visible_to_current_user(public.notices) to authenticated;

-- ---------------------------------------------------------------------------
-- list_active_notices_for_me
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

  -- Inbox row required (admin_create_notice bulk-inserts targets).
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

revoke all on function public.list_active_notices_for_me(text) from public;
grant execute on function public.list_active_notices_for_me(text) to authenticated;

-- ---------------------------------------------------------------------------
-- list_my_notice_inbox
-- ---------------------------------------------------------------------------
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

revoke all on function public.list_my_notice_inbox(int, timestamptz) from public;
grant execute on function public.list_my_notice_inbox(int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- count_my_notice_inbox_unread
-- ---------------------------------------------------------------------------
create or replace function public.count_my_notice_inbox_unread()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  v_profile := public.current_profile_row_id();
  if v_profile is null then
    return 0;
  end if;

  select count(*)::int into v_count
  from public.user_notifications un
  inner join public.notices n on n.id = un.notice_id
  where un.profile_id = v_profile
    and un.is_read is not true
    and public.notice_visible_to_current_user(n);

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.count_my_notice_inbox_unread() from public;
grant execute on function public.count_my_notice_inbox_unread() to authenticated;

-- ---------------------------------------------------------------------------
-- mark_notice_inbox_read
-- ---------------------------------------------------------------------------
create or replace function public.mark_notice_inbox_read(p_inbox_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_updated int := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  if p_inbox_id is null then
    raise exception 'inbox_id_required';
  end if;

  v_profile := public.current_profile_row_id();
  if v_profile is null then
    raise exception 'not_found';
  end if;

  update public.user_notifications
  set is_read = true
  where id = p_inbox_id
    and profile_id = v_profile;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_found';
  end if;

  return true;
end;
$$;

revoke all on function public.mark_notice_inbox_read(uuid) from public;
grant execute on function public.mark_notice_inbox_read(uuid) to authenticated;

create or replace function public.mark_notice_inbox_read_by_notice_id(p_notice_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_updated int := 0;
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

  update public.user_notifications
  set is_read = true
  where notice_id = p_notice_id
    and profile_id = v_profile;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'not_found';
  end if;

  return true;
end;
$$;

revoke all on function public.mark_notice_inbox_read_by_notice_id(uuid) from public;
grant execute on function public.mark_notice_inbox_read_by_notice_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_notice_detail_for_me
-- ---------------------------------------------------------------------------
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
    'start_at', v_row.start_at,
    'end_at', v_row.end_at,
    'target_scope', v_row.target_scope,
    'created_at', v_row.created_at,
    'inbox_id', v_inbox_id,
    'is_read', coalesce(v_is_read, false)
  );
end;
$$;

revoke all on function public.get_notice_detail_for_me(uuid) from public;
grant execute on function public.get_notice_detail_for_me(uuid) to authenticated;

notify pgrst, 'reload schema';
