-- ledger_meeting_put_doc: extra_data.fs participantIds 와 public.meeting_participants 동기화
--
-- 배경:
-- - 홈 비공개/내 모임 목록 RPC는 public.meeting_participants 를 기준으로 비호스트 참여 모임을 찾는다.
-- - 앱의 Supabase 참여 경로는 원장 JSON(extra_data.fs.participantIds)만 갱신해,
--   참여자는 상세에는 보이지만 목록 RPC에서는 빠질 수 있었다.
--
-- 정책:
-- - p_doc.createdBy / participantIds 에 매칭되는 앱 회원 프로필은 meeting_participants 에 upsert 한다.
-- - p_doc 에서 빠진 기존 행은 이전 마이그레이션과 동일하게 prune 한다.
-- - 웹 공유 비회원처럼 profiles 행이 없는 participantId 는 원장 JSON 에만 남긴다.

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
  v_allow_sync boolean;
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

  v_allow_sync :=
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

  if not v_allow_sync then
    return;
  end if;

  with
  host_key as (
    select public.ginit_normalize_app_user_id(trim(coalesce(p_doc->>'createdBy', ''))) as nk, 'host'::text as role
  ),
  pid_keys as (
    select distinct public.ginit_normalize_app_user_id(trim(elem::text)) as nk, 'member'::text as role
    from jsonb_array_elements_text(
      case
        when p_doc ? 'participantIds' and jsonb_typeof(p_doc->'participantIds') = 'array' then p_doc->'participantIds'
        when p_doc ? 'participant_ids' and jsonb_typeof(p_doc->'participant_ids') = 'array' then p_doc->'participant_ids'
        else '[]'::jsonb
      end
    ) as t(elem)
    where nullif(trim(elem::text), '') is not null
  ),
  desired_roles as (
    select
      nk,
      case when bool_or(role = 'host') then 'host' else 'member' end as role
    from (
      select nk, role from host_key
      union all
      select nk, role from pid_keys
    ) x
    where nullif(nk, '') is not null
    group by nk
  )
  insert into public.meeting_participants (meeting_id, profile_id, role)
  select v, pr.id, dr.role
  from desired_roles dr
  inner join public.profiles pr
    on public.ginit_normalize_app_user_id(coalesce(pr.app_user_id, '')) = dr.nk
  where nullif(public.ginit_normalize_app_user_id(coalesce(pr.app_user_id, '')), '') is not null
  on conflict (meeting_id, profile_id) do update
  set role = excluded.role;

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

with
fs_host_keys as (
  select
    m.id as meeting_id,
    public.ginit_normalize_app_user_id(coalesce(m.extra_data->'fs'->>'createdBy', '')) as nk,
    'host'::text as role
  from public.meetings m
  where nullif(public.ginit_normalize_app_user_id(coalesce(m.extra_data->'fs'->>'createdBy', '')), '') is not null
),
fs_participant_keys as (
  select
    m.id as meeting_id,
    public.ginit_normalize_app_user_id(trim(elem::text)) as nk,
    'member'::text as role
  from public.meetings m
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(m.extra_data->'fs'->'participantIds') = 'array' then m.extra_data->'fs'->'participantIds'
      when jsonb_typeof(m.extra_data->'fs'->'participant_ids') = 'array' then m.extra_data->'fs'->'participant_ids'
      else '[]'::jsonb
    end
  ) as p(elem)
  where nullif(trim(elem::text), '') is not null
),
desired_roles as (
  select
    meeting_id,
    nk,
    case when bool_or(role = 'host') then 'host' else 'member' end as role
  from (
    select meeting_id, nk, role from fs_host_keys
    union all
    select meeting_id, nk, role from fs_participant_keys
  ) x
  where nullif(nk, '') is not null
  group by meeting_id, nk
)
insert into public.meeting_participants (meeting_id, profile_id, role)
select dr.meeting_id, pr.id, dr.role
from desired_roles dr
inner join public.profiles pr
  on public.ginit_normalize_app_user_id(coalesce(pr.app_user_id, '')) = dr.nk
where nullif(public.ginit_normalize_app_user_id(coalesce(pr.app_user_id, '')), '') is not null
on conflict (meeting_id, profile_id) do update
set role = excluded.role;

notify pgrst, 'reload schema';
