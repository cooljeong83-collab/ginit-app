-- Admin: meeting_categories list (usage counts) + upsert / delete / reorder
-- (복구: 기존 0215_admin_meeting_categories_crud 가 0215_admin_chat_monitor 에 덮인 경우)

create or replace function public.admin_list_meeting_categories()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'label', c.label,
        'emoji', c.emoji,
        'sort_order', c.sort_order,
        'major_code', c.major_code,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'meeting_count', coalesce((
          select count(*)::int
          from public.meetings m
          where m.category_id = c.id
        ), 0)
      )
      order by c.sort_order asc nulls last, c.label asc
    )
    from public.meeting_categories c
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_upsert_meeting_category(
  p_id text,
  p_label text,
  p_emoji text default '📌',
  p_sort_order int default null,
  p_major_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(trim(coalesce(p_id, '')), '');
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_emoji text := coalesce(nullif(trim(coalesce(p_emoji, '')), ''), '📌');
  v_major text := nullif(trim(coalesce(p_major_code, '')), '');
  v_sort int;
  v_row public.meeting_categories%rowtype;
begin
  perform public.assert_current_user_admin();

  if v_label is null then
    raise exception 'label_required';
  end if;
  if v_id is null then
    raise exception 'id_required';
  end if;
  if length(v_id) > 80 then
    raise exception 'id_too_long';
  end if;

  v_sort := coalesce(p_sort_order, (
    select coalesce(max(sort_order), 0) + 10
    from public.meeting_categories
  ));

  insert into public.meeting_categories (id, label, emoji, sort_order, major_code)
  values (v_id, v_label, v_emoji, v_sort, v_major)
  on conflict (id) do update
  set label = excluded.label,
      emoji = excluded.emoji,
      sort_order = coalesce(p_sort_order, public.meeting_categories.sort_order),
      major_code = excluded.major_code,
      updated_at = now();

  select * into v_row from public.meeting_categories where id = v_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_delete_meeting_category(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(trim(coalesce(p_id, '')), '');
  v_used int;
begin
  perform public.assert_current_user_admin();
  if v_id is null then
    raise exception 'id_required';
  end if;

  select count(*)::int into v_used
  from public.meetings m
  where m.category_id = v_id;

  if v_used > 0 then
    raise exception 'category_in_use' using
      message = format('이 카테고리를 쓰는 모임이 %s건 있어 삭제할 수 없습니다.', v_used);
  end if;

  delete from public.meeting_categories where id = v_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

create or replace function public.admin_move_meeting_category(
  p_id text,
  p_direction text default 'up'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(trim(coalesce(p_id, '')), '');
  v_dir text := lower(trim(coalesce(p_direction, 'up')));
  v_ids text[];
  v_idx int;
  v_other_id text;
  v_sort_a int;
  v_sort_b int;
begin
  perform public.assert_current_user_admin();
  if v_id is null then
    raise exception 'id_required';
  end if;

  select array_agg(c.id order by c.sort_order asc nulls last, c.label asc)
  into v_ids
  from public.meeting_categories c;

  if v_ids is null then
    return '[]'::jsonb;
  end if;

  v_idx := array_position(v_ids, v_id);
  if v_idx is null then
    raise exception 'not_found';
  end if;

  if v_dir = 'up' then
    if v_idx <= 1 then
      return public.admin_list_meeting_categories();
    end if;
    v_other_id := v_ids[v_idx - 1];
  elsif v_dir = 'down' then
    if v_idx >= array_length(v_ids, 1) then
      return public.admin_list_meeting_categories();
    end if;
    v_other_id := v_ids[v_idx + 1];
  else
    raise exception 'invalid_direction';
  end if;

  select sort_order into v_sort_a from public.meeting_categories where id = v_id;
  select sort_order into v_sort_b from public.meeting_categories where id = v_other_id;

  update public.meeting_categories set sort_order = v_sort_b where id = v_id;
  update public.meeting_categories set sort_order = v_sort_a where id = v_other_id;

  return public.admin_list_meeting_categories();
end;
$$;

revoke all on function public.admin_upsert_meeting_category(text, text, text, int, text) from public;
grant execute on function public.admin_upsert_meeting_category(text, text, text, int, text) to authenticated;

revoke all on function public.admin_delete_meeting_category(text) from public;
grant execute on function public.admin_delete_meeting_category(text) to authenticated;

revoke all on function public.admin_move_meeting_category(text, text) from public;
grant execute on function public.admin_move_meeting_category(text, text) to authenticated;

notify pgrst, 'reload schema';
