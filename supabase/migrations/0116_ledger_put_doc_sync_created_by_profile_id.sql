-- ledger_meeting_put_doc: meetings.created_by_profile_id 를 원장 p_doc.createdBy 와 동기화
--
-- 원인:
-- - ledger_list_my_meetings_for_feed 는 `created_by_profile_id = 내 profile` OR meeting_participants 로 판별한다.
-- - 방장 이관(transferMeetingHost) 등은 ledgerMeetingPutRawDoc 으로 fs.createdBy 만 바꾸고,
--   meetings.created_by_profile_id 는 갱신하지 않았다.
-- - 그 결과 이전 주최는 participantIds 에서도 빠졌는데(상세에 안 보임), SQL 주최 컬럼만 남아 "내 모임"에 계속 노출될 수 있다.
--
-- 정책:
-- - p_doc.createdBy 가 비어 있지 않고 profiles 에 매칭되면 created_by_profile_id 를 그 프로필 id 로 설정한다.
-- - 매칭 실패 시 기존 컬럼 유지(앱·레거시 데이터 보호).
-- - 매칭 규칙은 ledger_list_my_meetings_for_feed 의 profiles 조회와 동일하게 lower(trim) 양쪽 비교.

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
  v_host_profile_id uuid;
begin
  select pr.id into v_host_profile_id
  from public.profiles pr
  where nullif(trim(coalesce(p_doc->>'createdBy', '')), '') is not null
    and lower(trim(coalesce(pr.app_user_id, ''))) = lower(trim(p_doc->>'createdBy'))
  limit 1;

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
    created_by_profile_id = case
      when nullif(trim(coalesce(p_doc->>'createdBy', '')), '') is null then m.created_by_profile_id
      when v_host_profile_id is not null then v_host_profile_id
      else m.created_by_profile_id
    end,
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
