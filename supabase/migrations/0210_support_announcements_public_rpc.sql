-- 사용자 앱: 게시된 공지 목록·상세 (app_announcements)

create index if not exists app_announcements_published_list_idx
  on public.app_announcements (published_at desc nulls last)
  where status = 'published' and published_at is not null;

create or replace function public.normalize_announcement_region_norm(p_raw text)
returns text
language sql
immutable
as $$
  select nullif(lower(trim(coalesce(p_raw, ''))), '');
$$;

create or replace function public.current_profile_announcement_region_norm()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.normalize_announcement_region_norm(p.metadata->>'base_region')
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_withdrawn is not true
  limit 1;
$$;

revoke all on function public.current_profile_announcement_region_norm() from public;
grant execute on function public.current_profile_announcement_region_norm() to authenticated;

create or replace function public.announcement_visible_to_current_user(a public.app_announcements)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    a.status = 'published'
    and a.published_at is not null
    and a.target_type <> 'admin_preview'
    and (
      a.target_type = 'all'
      or (
        a.target_type = 'region'
        and public.normalize_announcement_region_norm(a.target_region_norm) is not null
        and public.normalize_announcement_region_norm(a.target_region_norm)
          = public.current_profile_announcement_region_norm()
      )
    );
$$;

revoke all on function public.announcement_visible_to_current_user(public.app_announcements) from public;
grant execute on function public.announcement_visible_to_current_user(public.app_announcements) to authenticated;

create or replace function public.list_published_announcements(
  p_limit int default 20,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb;
  v_next timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.published_at desc), '[]'::jsonb)
  into v_items
  from (
    select a.id, a.title, a.published_at, a.image_url
    from public.app_announcements a
    where public.announcement_visible_to_current_user(a)
      and (p_cursor is null or a.published_at < p_cursor)
    order by a.published_at desc
    limit v_limit + 1
  ) x;

  select count(*)::int, min(t.published_at)
  into v_count, v_next
  from (
    select a.published_at
    from public.app_announcements a
    where public.announcement_visible_to_current_user(a)
      and (p_cursor is null or a.published_at < p_cursor)
    order by a.published_at desc
    limit v_limit + 1
  ) t;

  if v_count > v_limit then
    select min(published_at) into v_next
    from (
      select a.published_at
      from public.app_announcements a
      where public.announcement_visible_to_current_user(a)
        and (p_cursor is null or a.published_at < p_cursor)
      order by a.published_at desc
      limit v_limit + 1
    ) s;
    v_items := coalesce((
      select jsonb_agg(elem order by (elem->>'published_at')::timestamptz desc)
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

revoke all on function public.list_published_announcements(int, timestamptz) from public;
grant execute on function public.list_published_announcements(int, timestamptz) to authenticated;

create or replace function public.get_published_announcement(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.app_announcements%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  if p_id is null then
    raise exception 'id_required';
  end if;

  select * into v_row from public.app_announcements where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not public.announcement_visible_to_current_user(v_row) then
    raise exception 'not_found';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'body', v_row.body,
    'image_url', v_row.image_url,
    'published_at', v_row.published_at
  );
end;
$$;

revoke all on function public.get_published_announcement(uuid) from public;
grant execute on function public.get_published_announcement(uuid) to authenticated;

notify pgrst, 'reload schema';
