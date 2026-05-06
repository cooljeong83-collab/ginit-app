-- 0075: 0072_places_place_reviews_and_ledger_place_key.sql 되돌리기(revert)
-- 목적:
-- - public.places / public.place_reviews / view_place_rating_summary 제거
-- - meetings.place_key 컬럼 제거
-- - place 관련 RPC 제거
-- - ledger_meeting_put_doc 본문을 0072 적용 전(0008/0027 본문)으로 복원
--
-- 참고:
-- - 8a821bc 이후 추가된 0073/0074는 친구/프로필 사진 이력 관련으로,
--   "모임 목록/모임 생성" 복구와는 직접적인 DB 의존성이 없습니다.

-- ─── ledger_meeting_put_doc: 0072 이전 본문으로 복원 ───────────────────────
create or replace function public.ledger_meeting_put_doc(p_meeting_id text, p_doc jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := p_meeting_id::uuid;
  v_title text := coalesce(nullif(trim(p_doc->>'title'), ''), '제목 없음');
  v_desc text := coalesce(nullif(trim(p_doc->>'description'), ''), '');
  v_cap int := greatest(1, coalesce((p_doc->>'capacity')::int, 1));
  v_min int := case when p_doc ? 'minParticipants' and p_doc->>'minParticipants' is not null then (p_doc->>'minParticipants')::int else null end;
  v_cat_id text := coalesce(nullif(trim(p_doc->>'categoryId'), ''), '');
  v_cat_lbl text := coalesce(nullif(trim(p_doc->>'categoryLabel'), ''), '');
  v_pub boolean := coalesce((p_doc->>'isPublic')::boolean, false);
  v_img text := nullif(trim(p_doc->>'imageUrl'), '');
  v_place text := coalesce(nullif(trim(p_doc->>'placeName'), ''), '');
  v_addr text := coalesce(nullif(trim(p_doc->>'address'), ''), '');
  v_lat double precision := coalesce((p_doc->>'latitude')::double precision, 0);
  v_lng double precision := coalesce((p_doc->>'longitude')::double precision, 0);
  v_sd text := coalesce(nullif(trim(p_doc->>'scheduleDate'), ''), '');
  v_st text := coalesce(nullif(trim(p_doc->>'scheduleTime'), ''), '');
  v_sched timestamptz := case
    when p_doc ? 'scheduledAt' and p_doc->>'scheduledAt' is not null then (p_doc->>'scheduledAt')::timestamptz
    else null
  end;
  v_conf boolean := coalesce((p_doc->>'scheduleConfirmed')::boolean, false);
  v_cd text := nullif(trim(p_doc->>'confirmedDateChipId'), '');
  v_cp text := nullif(trim(p_doc->>'confirmedPlaceChipId'), '');
  v_cm text := nullif(trim(p_doc->>'confirmedMovieChipId'), '');
begin
  update public.meetings m
  set
    extra_data = jsonb_set(coalesce(m.extra_data, '{}'::jsonb), '{fs}', p_doc, true),
    title = v_title,
    description = nullif(v_desc, ''),
    capacity = v_cap,
    min_participants = v_min,
    category_id = nullif(v_cat_id, ''),
    category_label = nullif(v_cat_lbl, ''),
    is_public = v_pub,
    image_url = nullif(v_img, ''),
    place_name = nullif(v_place, ''),
    address = nullif(v_addr, ''),
    latitude = v_lat,
    longitude = v_lng,
    schedule_date = nullif(v_sd, ''),
    schedule_time = nullif(v_st, ''),
    scheduled_at = v_sched,
    schedule_confirmed = v_conf,
    confirmed_date_chip_id = v_cd,
    confirmed_place_chip_id = v_cp,
    confirmed_movie_chip_id = v_cm,
    updated_at = now()
  where m.id = v;
end;
$$;

revoke all on function public.ledger_meeting_put_doc(text, jsonb) from public;
grant execute on function public.ledger_meeting_put_doc(text, jsonb) to anon, authenticated;

-- ─── place 관련 RPC 제거 ───────────────────────────────────────────────────
drop function if exists public.upsert_my_place_review(text, text, uuid, numeric, text[]);
drop function if exists public.get_place_rating_summary(text);
drop function if exists public.upsert_place_snapshot(
  text, text, text, double precision, double precision, text, text, text
);

-- ─── 집계 뷰 제거 ──────────────────────────────────────────────────────────
drop view if exists public.view_place_rating_summary;

-- ─── 테이블 제거 (의존성: place_reviews -> places) ─────────────────────────
drop table if exists public.place_reviews;
drop trigger if exists trg_places_touch on public.places;
drop table if exists public.places;

-- ─── meetings.place_key 제거 ───────────────────────────────────────────────
alter table public.meetings drop column if exists place_key;

notify pgrst, 'reload schema';

