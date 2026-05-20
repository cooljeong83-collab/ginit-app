-- Distinct feed regions for admin combobox + correct cursor paging for admin_list_meetings

create or replace function public.admin_list_meeting_feed_regions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_current_user_admin();

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('region_norm', r.region_norm, 'meeting_count', r.meeting_count)
        order by r.region_norm
      ),
      '[]'::jsonb
    )
    from (
      select
        nullif(trim(m.feed_region_norm), '') as region_norm,
        count(*)::int as meeting_count
      from public.meetings m
      where nullif(trim(m.feed_region_norm), '') is not null
      group by 1
    ) r
  );
end;
$$;

revoke all on function public.admin_list_meeting_feed_regions() from public;
grant execute on function public.admin_list_meeting_feed_regions() to authenticated;

create or replace function public.admin_list_meetings(
  p_region_norm text default null,
  p_search text default null,
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
  v_raw_count int;
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at desc nulls last), '[]'::jsonb)
  into v_items
  from (
    select
      m.id,
      m.title,
      m.feed_region_norm,
      m.scheduled_at,
      m.is_public,
      coalesce(nullif(trim(m.place_name), ''), '') as place_name,
      coalesce(
        nullif(trim(m.extra_data->'fs'->>'lifecycleStatus'), ''),
        nullif(trim(m.extra_data->>'lifecycleStatus'), ''),
        'unknown'
      ) as lifecycle_status,
      (select count(*)::int from public.meeting_participants mp where mp.meeting_id = m.id) as participant_count
    from public.meetings m
    where (p_cursor is null or m.scheduled_at < p_cursor or m.scheduled_at is null)
      and (
        p_region_norm is null
        or trim(p_region_norm) = ''
        or trim(m.feed_region_norm) = trim(p_region_norm)
      )
      and (
        p_search is null
        or trim(p_search) = ''
        or m.title ilike '%' || trim(p_search) || '%'
        or coalesce(m.place_name, '') ilike '%' || trim(p_search) || '%'
      )
    order by m.scheduled_at desc nulls last
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'scheduled_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'scheduled_at') desc nulls last), '[]'::jsonb)
      from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      where ord <= v_limit
    );
  else
    v_next := null;
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_meetings(text, text, int, timestamptz) from public;
grant execute on function public.admin_list_meetings(text, text, int, timestamptz) to authenticated;

notify pgrst, 'reload schema';
