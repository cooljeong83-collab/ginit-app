-- Admin meetings/reviews: search + richer list/detail fields

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
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at desc nulls last), '[]'::jsonb),
         min(x.scheduled_at)
  into v_items, v_next
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

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_meetings(text, text, int, timestamptz) from public;
grant execute on function public.admin_list_meetings(text, text, int, timestamptz) to authenticated;

drop function if exists public.admin_list_meetings(text, int, timestamptz);

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
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
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
        p_region_norm is null or trim(p_region_norm) = ''
        or trim(m.feed_region_norm) = trim(p_region_norm)
      )
      and (p_meeting_id is null or r.meeting_id = p_meeting_id)
    order by
      case when coalesce(r.admin_pick, false) then 0 else 1 end,
      r.created_at desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_meeting_reviews(text, boolean, boolean, uuid, int, timestamptz) from public;
grant execute on function public.admin_list_meeting_reviews(text, boolean, boolean, uuid, int, timestamptz) to authenticated;

drop function if exists public.admin_list_meeting_reviews(text, boolean, int, timestamptz);

create or replace function public.admin_get_meeting_review(p_review_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r public.meeting_reviews%rowtype;
  v_m public.meetings%rowtype;
  v_reviewer_nickname text;
  v_lifecycle text;
begin
  perform public.assert_current_user_admin();
  select * into v_r from public.meeting_reviews where id = p_review_id;
  if not found then raise exception 'not_found'; end if;
  select * into v_m from public.meetings where id = v_r.meeting_id;

  select coalesce(nullif(trim(p.nickname), ''), v_r.reviewer_app_user_id)
  into v_reviewer_nickname
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id)
      = public.ginit_normalize_app_user_id(v_r.reviewer_app_user_id)
  limit 1;

  v_lifecycle := coalesce(
    nullif(trim(v_m.extra_data->'fs'->>'lifecycleStatus'), ''),
    nullif(trim(v_m.extra_data->>'lifecycleStatus'), ''),
    'unknown'
  );

  return jsonb_build_object(
    'review', to_jsonb(v_r),
    'meeting', to_jsonb(v_m),
    'reviewer_nickname', v_reviewer_nickname,
    'lifecycle_status', v_lifecycle
  );
end;
$$;

revoke all on function public.admin_get_meeting_review(uuid) from public;
grant execute on function public.admin_get_meeting_review(uuid) to authenticated;

notify pgrst, 'reload schema';
