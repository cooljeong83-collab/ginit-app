-- Review feed regions for admin combobox + cursor paging for admin_list_meeting_reviews

create or replace function public.admin_list_review_feed_regions()
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
        jsonb_build_object('region_norm', r.region_norm, 'review_count', r.review_count)
        order by r.region_norm
      ),
      '[]'::jsonb
    )
    from (
      select
        nullif(trim(m.feed_region_norm), '') as region_norm,
        count(*)::int as review_count
      from public.meeting_reviews r
      inner join public.meetings m on m.id = r.meeting_id
      where nullif(trim(m.feed_region_norm), '') is not null
      group by 1
    ) r
  );
end;
$$;

revoke all on function public.admin_list_review_feed_regions() from public;
grant execute on function public.admin_list_review_feed_regions() to authenticated;

create or replace function public.admin_list_meeting_reviews(
  p_region_norm text default null,
  p_admin_pick_only boolean default false,
  p_has_comment_only boolean default false,
  p_meeting_id uuid default null,
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

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      r.id,
      r.meeting_id,
      m.title as meeting_title,
      nullif(trim(m.feed_region_norm), '') as region_norm,
      coalesce(nullif(trim(m.place_name), ''), '장소') as place_name,
      r.rating,
      coalesce(r.admin_pick, false) as admin_pick,
      coalesce(pr.nickname, r.reviewer_app_user_id) as reviewer_nickname,
      nullif(left(trim(coalesce(r.comment, '')), 100), '') as comment_preview,
      r.created_at
    from public.meeting_reviews r
    inner join public.meetings m on m.id = r.meeting_id
    left join public.profiles pr
      on public.ginit_normalize_app_user_id(pr.app_user_id)
       = public.ginit_normalize_app_user_id(r.reviewer_app_user_id)
    where (p_cursor is null or r.created_at < p_cursor)
      and (not coalesce(p_admin_pick_only, false) or coalesce(r.admin_pick, false))
      and (
        not coalesce(p_has_comment_only, false)
        or (r.comment is not null and trim(r.comment) <> '')
      )
      and (
        p_region_norm is null
        or trim(p_region_norm) = ''
        or trim(m.feed_region_norm) = trim(p_region_norm)
      )
      and (p_meeting_id is null or r.meeting_id = p_meeting_id)
    order by
      case when coalesce(r.admin_pick, false) then 0 else 1 end,
      r.created_at desc
    limit v_limit + 1
  ) x;

  v_raw_count := jsonb_array_length(coalesce(v_items, '[]'::jsonb));

  if v_raw_count > v_limit then
    select (elem->>'created_at')::timestamptz
    into v_next
    from jsonb_array_element(v_items, v_limit) as elem;

    v_items := (
      select coalesce(jsonb_agg(elem order by (elem->>'created_at') desc nulls last), '[]'::jsonb)
      from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      where ord <= v_limit
    );
  else
    v_next := null;
  end if;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_meeting_reviews(text, boolean, boolean, uuid, int, timestamptz) from public;
grant execute on function public.admin_list_meeting_reviews(text, boolean, boolean, uuid, int, timestamptz) to authenticated;

notify pgrst, 'reload schema';
