-- ledger_meeting_put_doc: 원장 JSON(extra_data.fs / p_doc)과 public.meeting_participants 불일치 보정
--
-- 배경:
-- - `ledger_list_my_meetings_for_feed` 등은 meeting_participants·created_by_profile_id를 본다.
-- - 모임 상세는 ledger_meeting_get_doc → extra_data.fs 만 본다.
-- - put_doc는 meetings 행만 갱신하고 meeting_participants를 건드리지 않아,
--   나가기/탈퇴 후에도 테이블에 고아 행이 남으면 "내 모임"에만 남는 증상이 난다.
--
-- 정책(앱 로직·클라이언트 변경 없음, 보수적):
-- - INSERT/UPSERT는 하지 않는다(fs 전용 참가자·기존 가입 플로우 유지).
-- - p_doc에 createdBy 또는 participantIds 항목이 비어 있지 않을 때만 prune 실행
--   (빈 문서로 전체 참가자 행을 지우는 사고 방지).
-- - ginit_normalize_app_user_id 로 profiles.app_user_id 와 p_doc 키를 맞춘다.

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
  v_cd text := coalesce(nullif(trim(p_doc->>'confirmedDateChipId'), ''), '');
  v_cp text := coalesce(nullif(trim(p_doc->>'confirmedPlaceChipId'), ''), '');
  v_cm text := coalesce(nullif(trim(p_doc->>'confirmedMovieChipId'), ''), '');
  v_allow_prune boolean;
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

  v_allow_prune :=
    (nullif(trim(coalesce(p_doc->>'createdBy', '')), '') is not null)
    or exists (
      select 1
      from jsonb_array_elements_text(
        case
          when p_doc ? 'participantIds' and jsonb_typeof(p_doc->'participantIds') = 'array' then p_doc->'participantIds'
          when p_doc ? 'participant_ids' and jsonb_typeof(p_doc->'participant_ids') = 'array' then p_doc->'participant_ids'
          else '[]'::jsonb
        end
      ) as e(elem)
      where nullif(trim(elem::text), '') is not null
    );

  if not v_allow_prune then
    return;
  end if;

  with
  host_key as (
    select public.ginit_normalize_app_user_id(trim(coalesce(p_doc->>'createdBy', ''))) as nk
  ),
  pid_keys as (
    select distinct public.ginit_normalize_app_user_id(trim(elem::text)) as nk
    from jsonb_array_elements_text(
      case
        when p_doc ? 'participantIds' and jsonb_typeof(p_doc->'participantIds') = 'array' then p_doc->'participantIds'
        when p_doc ? 'participant_ids' and jsonb_typeof(p_doc->'participant_ids') = 'array' then p_doc->'participant_ids'
        else '[]'::jsonb
      end
    ) as t(elem)
    where nullif(trim(elem::text), '') is not null
  ),
  allowed_norm as (
    select nk from host_key where nullif(nk, '') is not null
    union
    select nk from pid_keys where nullif(nk, '') is not null
  )
  delete from public.meeting_participants mp
  where mp.meeting_id = v
    and not exists (
      select 1
      from public.profiles pr
      where pr.id = mp.profile_id
        and nullif(public.ginit_normalize_app_user_id(coalesce(pr.app_user_id, '')), '') is not null
        and public.ginit_normalize_app_user_id(coalesce(pr.app_user_id, '')) in (select nk from allowed_norm)
    );
end;
$$;

revoke all on function public.ledger_meeting_put_doc(text, jsonb) from public;
grant execute on function public.ledger_meeting_put_doc(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
