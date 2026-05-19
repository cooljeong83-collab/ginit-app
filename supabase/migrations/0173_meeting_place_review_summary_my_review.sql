-- 써머리 RPC에 요청자 본인 후기(my_review) 포함 — 수정 폼 프리필용

create or replace function public.get_meeting_place_review_summary(
  p_meeting_id text,
  p_app_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_uid text := nullif(trim(coalesce(p_app_user_id, '')), '');
  v_avg numeric;
  v_count int;
  v_participants jsonb;
  v_keywords jsonb;
  v_comments jsonb;
  v_my_review jsonb;
begin
  if v_uid is null then
    raise exception 'app_user_id_required';
  end if;

  begin
    v_mid := p_meeting_id::uuid;
  exception
    when others then
      raise exception 'invalid_meeting_id';
  end;

  if not exists (select 1 from public.meetings m where m.id = v_mid) then
    raise exception 'meeting_not_found';
  end if;

  if not public.meeting_review_is_participant(v_mid, v_uid) then
    raise exception 'not_a_meeting_participant';
  end if;

  select round(avg(r.rating)::numeric, 1), count(*)::int
  into v_avg, v_count
  from public.meeting_reviews r
  where r.meeting_id = v_mid;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'app_user_id', x.app_user_id,
        'display_name', x.display_name,
        'avatar_url', x.avatar_url,
        'has_reviewed', x.has_reviewed
      )
      order by x.sort_ord, x.display_name
    ),
    '[]'::jsonb
  )
  into v_participants
  from (
    select distinct on (norm_id)
      norm_id as app_user_id,
      coalesce(nullif(btrim(p.nickname), ''), '회원') as display_name,
      nullif(btrim(p.photo_url), '') as avatar_url,
      exists (
        select 1
        from public.meeting_reviews mr
        where mr.meeting_id = v_mid
          and public.ginit_normalize_app_user_id(mr.reviewer_app_user_id) = norm_id
      ) as has_reviewed,
      case
        when exists (
          select 1 from public.meeting_reviews mr2
          where mr2.meeting_id = v_mid
            and public.ginit_normalize_app_user_id(mr2.reviewer_app_user_id) = norm_id
        ) then 0
        else 1
      end as sort_ord
    from (
      select public.ginit_normalize_app_user_id(trim(mp_src.app_user_id)) as norm_id
      from (
        select pr.app_user_id
        from public.meeting_participants mpart
        join public.profiles pr on pr.id = mpart.profile_id
        where mpart.meeting_id = v_mid
          and pr.app_user_id is not null
          and btrim(pr.app_user_id) <> ''
        union
        select trim(pid.participant_id) as app_user_id
        from public.meetings m2
        cross join lateral jsonb_array_elements_text(
          coalesce(
            m2.extra_data->'fs'->'participantIds',
            m2.extra_data->'fs'->'participant_ids',
            '[]'::jsonb
          )
        ) as pid(participant_id)
        where m2.id = v_mid
        union
        select pr2.app_user_id
        from public.meetings m3
        join public.profiles pr2 on pr2.id = m3.created_by_profile_id
        where m3.id = v_mid
          and pr2.app_user_id is not null
          and btrim(pr2.app_user_id) <> ''
      ) mp_src
      where trim(mp_src.app_user_id) <> ''
    ) ids
    left join public.profiles p
      on public.ginit_normalize_app_user_id(p.app_user_id) = ids.norm_id
    where ids.norm_id is not null
      and ids.norm_id <> ''
    order by norm_id, display_name
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('keyword', k.keyword, 'count', k.cnt)
      order by k.cnt desc, k.keyword asc
    ),
    '[]'::jsonb
  )
  into v_keywords
  from (
    select kw.keyword, count(*)::int as cnt
    from public.meeting_reviews r
    cross join lateral unnest(r.selected_keywords) as kw(keyword)
    where r.meeting_id = v_mid
    group by kw.keyword
  ) k;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'display_name', coalesce(nullif(btrim(p.nickname), ''), '회원'),
        'comment', r.comment,
        'created_at', r.created_at
      )
      order by r.created_at asc
    ),
    '[]'::jsonb
  )
  into v_comments
  from public.meeting_reviews r
  left join public.profiles p
    on public.ginit_normalize_app_user_id(p.app_user_id)
     = public.ginit_normalize_app_user_id(r.reviewer_app_user_id)
  where r.meeting_id = v_mid
    and r.comment is not null
    and btrim(r.comment) <> '';

  select jsonb_build_object(
    'rating', r.rating,
    'selected_keywords', coalesce(r.selected_keywords, '{}'::text[]),
    'comment', r.comment
  )
  into v_my_review
  from public.meeting_reviews r
  where r.meeting_id = v_mid
    and public.ginit_normalize_app_user_id(r.reviewer_app_user_id)
      = public.ginit_normalize_app_user_id(v_uid)
  limit 1;

  return jsonb_build_object(
    'average_rating', coalesce(v_avg, 0),
    'review_count', coalesce(v_count, 0),
    'participants', v_participants,
    'keyword_stats', v_keywords,
    'comments', v_comments,
    'my_review', v_my_review
  );
end;
$$;

revoke all on function public.get_meeting_place_review_summary(text, text) from public;
grant execute on function public.get_meeting_place_review_summary(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
