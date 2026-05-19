-- 모임 장소 리뷰(정산 완료 후) — meeting_participants / fs.participantIds 참여자 전용.
-- 직접 테이블 접근은 차단하고 security definer RPC만 사용합니다.

create table if not exists public.meeting_reviews (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  reviewer_app_user_id text not null,
  place_id text not null,
  rating smallint not null,
  selected_keywords text[] not null default '{}'::text[],
  comment text,
  created_at timestamptz not null default now(),
  constraint meeting_reviews_rating_range check (rating between 1 and 5),
  constraint meeting_reviews_unique_per_user unique (meeting_id, reviewer_app_user_id),
  constraint meeting_reviews_comment_len check (comment is null or char_length(comment) <= 200)
);

create index if not exists meeting_reviews_meeting_created_idx
  on public.meeting_reviews (meeting_id, created_at desc);

alter table public.meeting_reviews enable row level security;

revoke all on table public.meeting_reviews from public;
revoke all on table public.meeting_reviews from anon;
revoke all on table public.meeting_reviews from authenticated;

alter table public.meeting_reviews replica identity full;

-- ─── 헬퍼: 모임 정산 완료 여부 ─────────────────────────────────────────────
create or replace function public.meeting_review_is_settled(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    upper(nullif(trim(coalesce(m.extra_data->'fs'->>'lifecycleStatus', '')), '')) = 'SETTLED',
    false
  )
  from public.meetings m
  where m.id = p_meeting_id;
$$;

-- ─── 헬퍼: 참여자(테이블·원장·호스트) ─────────────────────────────────────
create or replace function public.meeting_review_is_participant(
  p_meeting_id uuid,
  p_app_user_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_host_id uuid;
  v_in_table boolean;
  v_in_fs boolean;
begin
  if p_meeting_id is null or p_app_user_id is null or trim(p_app_user_id) = '' then
    return false;
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id)
      = public.ginit_normalize_app_user_id(trim(p_app_user_id))
    and p.is_withdrawn is not true
  limit 1;

  if v_profile_id is null then
    return false;
  end if;

  select m.created_by_profile_id into v_host_id
  from public.meetings m
  where m.id = p_meeting_id
  limit 1;

  if v_host_id is not null and v_host_id = v_profile_id then
    return true;
  end if;

  select exists (
    select 1
    from public.meeting_participants mp
    where mp.meeting_id = p_meeting_id
      and mp.profile_id = v_profile_id
  )
  into v_in_table;

  if v_in_table then
    return true;
  end if;

  select exists (
    select 1
    from public.meetings m2
    cross join lateral jsonb_array_elements_text(
      coalesce(
        m2.extra_data->'fs'->'participantIds',
        m2.extra_data->'fs'->'participant_ids',
        '[]'::jsonb
      )
    ) as pid(participant_id)
    where m2.id = p_meeting_id
      and public.ginit_normalize_app_user_id(trim(pid.participant_id))
        = public.ginit_normalize_app_user_id(trim(p_app_user_id))
  )
  into v_in_fs;

  return coalesce(v_in_fs, false);
end;
$$;

-- ─── 헬퍼: 허용 키워드 화이트리스트 ───────────────────────────────────────
create or replace function public.meeting_review_allowed_keywords()
returns text[]
language sql
immutable
as $$
  select array[
    '음식이 맛있어요',
    '양도 푸짐해요',
    '재료가 신선해요',
    '메뉴가 다양해요',
    '간이 적절해요',
    '커피가 맛있어요',
    '디저트가 다양해요',
    '분위기가 예뻐요',
    '공부하기 좋아요',
    '조용해요',
    '안주가 맛있어요',
    '술 종류가 많아요',
    '대화하기 좋아요',
    '분위기가 힙해요',
    '단체석 완비',
    '모임 장소로 딱!',
    '친구들이랑 다시 올래',
    '결제하기 편함'
  ]::text[];
$$;

-- ─── RPC: 리뷰 upsert ─────────────────────────────────────────────────────
create or replace function public.upsert_meeting_place_review(
  p_meeting_id text,
  p_app_user_id text,
  p_place_id text,
  p_rating integer,
  p_selected_keywords text[] default '{}'::text[],
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_uid text := nullif(trim(coalesce(p_app_user_id, '')), '');
  v_place text := nullif(trim(coalesce(p_place_id, '')), '');
  v_keywords text[] := coalesce(p_selected_keywords, '{}'::text[]);
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_allowed text[] := public.meeting_review_allowed_keywords();
  v_bad_kw text;
begin
  if v_uid is null then
    raise exception 'app_user_id_required';
  end if;
  if v_place is null then
    raise exception 'place_id_required';
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

  if not public.meeting_review_is_settled(v_mid) then
    raise exception 'meeting_not_settled';
  end if;

  if not public.meeting_review_is_participant(v_mid, v_uid) then
    raise exception 'not_a_meeting_participant';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  if coalesce(array_length(v_keywords, 1), 0) > 3 then
    raise exception 'too_many_keywords';
  end if;

  select kw into v_bad_kw
  from unnest(v_keywords) as kw
  where not (kw = any (v_allowed))
  limit 1;

  if v_bad_kw is not null then
    raise exception 'invalid_keyword';
  end if;

  insert into public.meeting_reviews (
    meeting_id,
    reviewer_app_user_id,
    place_id,
    rating,
    selected_keywords,
    comment
  )
  values (
    v_mid,
    v_uid,
    v_place,
    p_rating::smallint,
    v_keywords,
    v_comment
  )
  on conflict (meeting_id, reviewer_app_user_id) do update
  set
    place_id = excluded.place_id,
    rating = excluded.rating,
    selected_keywords = excluded.selected_keywords,
    comment = excluded.comment,
    created_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.upsert_meeting_place_review(text, text, text, integer, text[], text) from public;
grant execute on function public.upsert_meeting_place_review(text, text, text, integer, text[], text) to anon, authenticated;

-- ─── RPC: 써머리 집계 ─────────────────────────────────────────────────────
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

  return jsonb_build_object(
    'average_rating', coalesce(v_avg, 0),
    'review_count', coalesce(v_count, 0),
    'participants', v_participants,
    'keyword_stats', v_keywords,
    'comments', v_comments
  );
end;
$$;

revoke all on function public.get_meeting_place_review_summary(text, text) from public;
grant execute on function public.get_meeting_place_review_summary(text, text) to anon, authenticated;

-- ─── Realtime publication ─────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meeting_reviews'
  ) then
    execute 'alter publication supabase_realtime add table public.meeting_reviews';
  end if;
end $$;

notify pgrst, 'reload schema';
