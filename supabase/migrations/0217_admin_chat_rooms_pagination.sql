-- Admin chat room list: cursor pagination (5 per page) + server search

create or replace function public.admin_list_chat_rooms(
  p_limit int default 5,
  p_cursor text default null,
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
  v_next text;
  v_raw_count int;
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_cursor_at timestamptz;
  v_cursor_kind text;
  v_cursor_room text;
  v_cursor_ms text;
begin
  perform public.assert_current_user_admin();

  if p_cursor is not null and trim(p_cursor) <> '' then
    v_cursor_ms := split_part(trim(p_cursor), '|', 1);
    v_cursor_kind := nullif(trim(split_part(trim(p_cursor), '|', 2)), '');
    v_cursor_room := nullif(trim(split_part(trim(p_cursor), '|', 3)), '');
    if v_cursor_ms ~ '^\d+$' and v_cursor_kind is not null and v_cursor_room is not null then
      v_cursor_at := to_timestamp(v_cursor_ms::bigint / 1000.0);
    else
      v_cursor_at := null;
      v_cursor_kind := null;
      v_cursor_room := null;
    end if;
  end if;

  with social as (
    select
      'social_dm'::text as room_kind,
      cr.id::text as room_id,
      cr.is_group,
      cr.participant_ids,
      coalesce(cr.last_message_at, cr.updated_at) as last_activity
    from public.chat_rooms cr
  ),
  meeting as (
    select
      'meeting'::text as room_kind,
      m.room_id,
      true as is_group,
      null::text[] as participant_ids,
      max(m.created_at) as last_activity
    from public.chat_messages m
    where m.room_kind = 'meeting'
      and m.deleted_at is null
    group by m.room_id
  ),
  unified as (
    select * from social
    union all
    select * from meeting
  ),
  stats as (
    select
      u.room_kind,
      u.room_id,
      u.is_group,
      u.participant_ids,
      u.last_activity,
      coalesce((
        select count(*)::int
        from public.chat_messages m
        where m.room_kind = u.room_kind
          and m.room_id = u.room_id
          and m.deleted_at is null
      ), 0) as message_count,
      (
        select left(coalesce(nullif(trim(m.body_text), ''), '[미디어]'), 120)
        from public.chat_messages m
        where m.room_kind = u.room_kind
          and m.room_id = u.room_id
          and m.deleted_at is null
        order by m.seq desc
        limit 1
      ) as last_preview
    from unified u
  ),
  enriched as (
    select
      s.room_kind,
      s.room_id,
      s.is_group,
      s.participant_ids,
      s.last_activity,
      s.message_count,
      s.last_preview,
      case
        when s.room_kind = 'meeting' then coalesce((
          select left(coalesce(nullif(trim(mt.title), ''), '모임'), 80)
          from public.meetings mt
          where mt.id::text = s.room_id
             or mt.legacy_firestore_id = s.room_id
          limit 1
        ), '모임 채팅')
        when s.is_group then '그룹 DM'
        else coalesce((
          select string_agg(p, ' · ' order by p)
          from unnest(s.participant_ids) p
          limit 2
        ), '1:1 DM')
      end as title
    from stats s
  ),
  filtered as (
    select *
    from enriched e
    where (
        v_cursor_at is null
        or v_cursor_kind is null
        or v_cursor_room is null
        or (e.last_activity, e.room_kind, e.room_id)
           < (v_cursor_at, v_cursor_kind, v_cursor_room)
      )
      and (
        v_q is null
        or e.title ilike '%' || v_q || '%'
        or e.room_id ilike '%' || v_q || '%'
        or coalesce(e.last_preview, '') ilike '%' || v_q || '%'
        or e.room_kind ilike '%' || v_q || '%'
        or coalesce(array_to_string(e.participant_ids, ' '), '') ilike '%' || v_q || '%'
      )
  ),
  paged as (
    select *
    from filtered
    order by last_activity desc nulls last, room_kind desc, room_id desc
    limit v_limit + 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'room_kind', p.room_kind,
        'room_id', p.room_id,
        'id', p.room_id,
        'is_group', p.is_group,
        'participant_ids', coalesce(p.participant_ids, '{}'::text[]),
        'title', p.title,
        'last_preview', p.last_preview,
        'message_count', p.message_count,
        'updated_at', p.last_activity
      )
      order by p.last_activity desc nulls last, p.room_kind desc, p.room_id desc
    ),
    '[]'::jsonb
  )
  into v_items
  from paged p;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select
      (extract(epoch from (elem->>'updated_at')::timestamptz) * 1000)::bigint::text
        || '|' || (elem->>'room_kind')
        || '|' || (elem->>'room_id')
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
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

revoke all on function public.admin_list_chat_rooms(int, text, text) from public;
grant execute on function public.admin_list_chat_rooms(int, text, text) to authenticated;

notify pgrst, 'reload schema';
