-- 신규 공개 모임 생성 시 «관심 지역 × 카테고리» 구독 사용자에게만 FCM fan-out 용.
-- 기존 채팅/친구/방해금지 RPC·테이블과 분리된 전용 테이블·RPC만 추가합니다.

alter table public.meetings
  add column if not exists feed_region_norm text;

comment on column public.meetings.feed_region_norm is
  '탐색/피드와 동일한 정규화 구 키(예: 영등포구, 인천 서구). 클라이언트 ledger_meeting_create p_doc.feedRegionNorm에서 채움.';

create index if not exists meetings_public_feed_region_idx
  on public.meetings (is_public, feed_region_norm)
  where is_public = true and feed_region_norm is not null and length(trim(feed_region_norm)) > 0;

-- ─── 구독 규칙 (profile_id + region_norm + category_id) ─────────────────────
create table if not exists public.profile_meeting_area_notify_rules (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  region_norm text not null,
  category_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, region_norm, category_id)
);

drop trigger if exists trg_profile_meeting_area_notify_rules_touch on public.profile_meeting_area_notify_rules;
create trigger trg_profile_meeting_area_notify_rules_touch
before update on public.profile_meeting_area_notify_rules
for each row execute function public.touch_updated_at();

alter table public.profile_meeting_area_notify_rules enable row level security;

revoke all on public.profile_meeting_area_notify_rules from public;

-- ─── ledger_meeting_create: feed_region_norm 만 append ─────────────────────
create or replace function public.ledger_meeting_create(p_host_app_user_id text, p_doc jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_id uuid := gen_random_uuid();
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
  v_feed_raw text := case when p_doc ? 'feedRegionNorm' then nullif(trim(p_doc->>'feedRegionNorm'), '') else null end;
  v_feed_region_norm text := null;
  v_fs jsonb := p_doc || jsonb_build_object('id', v_id::text);
begin
  if p_host_app_user_id is null or trim(p_host_app_user_id) = '' then
    raise exception 'host app_user_id required';
  end if;

  if v_feed_raw is not null
    and length(v_feed_raw) <= 80
    and position(chr(10) in v_feed_raw) = 0
    and position(chr(13) in v_feed_raw) = 0
  then
    v_feed_region_norm := v_feed_raw;
  end if;

  select id into v_host from public.profiles where app_user_id = trim(p_host_app_user_id) limit 1;
  if v_host is null then
    perform public.ensure_profile_minimal(p_host_app_user_id);
    select id into v_host from public.profiles where app_user_id = trim(p_host_app_user_id) limit 1;
  end if;

  insert into public.meetings (
    id,
    title,
    description,
    capacity,
    min_participants,
    category_id,
    category_label,
    is_public,
    image_url,
    place_name,
    address,
    latitude,
    longitude,
    schedule_date,
    schedule_time,
    scheduled_at,
    schedule_confirmed,
    created_by_profile_id,
    feed_region_norm,
    extra_data
  )
  values (
    v_id,
    v_title,
    nullif(v_desc, ''),
    v_cap,
    v_min,
    nullif(v_cat_id, ''),
    nullif(v_cat_lbl, ''),
    v_pub,
    nullif(v_img, ''),
    nullif(v_place, ''),
    nullif(v_addr, ''),
    v_lat,
    v_lng,
    nullif(v_sd, ''),
    nullif(v_st, ''),
    v_sched,
    coalesce((p_doc->>'scheduleConfirmed')::boolean, false),
    v_host,
    v_feed_region_norm,
    jsonb_build_object('fs', v_fs)
  );

  insert into public.meeting_participants (meeting_id, profile_id, role)
  values (v_id, v_host, 'host')
  on conflict do nothing;

  return v_id;
end;
$$;

revoke all on function public.ledger_meeting_create(text, jsonb) from public;
grant execute on function public.ledger_meeting_create(text, jsonb) to anon, authenticated;

-- ─── 구독 규칙 조회 (본인 app_user_id) ───────────────────────────────────────
create or replace function public.get_meeting_area_notify_rules(p_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_out jsonb;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    return '[]'::jsonb;
  end if;

  select p.id into v_pid from public.profiles p where p.app_user_id = trim(p_app_user_id) limit 1;
  if v_pid is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'region_norm', r.region_norm,
        'category_id', r.category_id,
        'enabled', r.enabled
      )
      order by r.region_norm, r.category_id
    ),
    '[]'::jsonb
  )
  into v_out
  from public.profile_meeting_area_notify_rules r
  where r.profile_id = v_pid;

  return coalesce(v_out, '[]'::jsonb);
end;
$$;

revoke all on function public.get_meeting_area_notify_rules(text) from public;
grant execute on function public.get_meeting_area_notify_rules(text) to anon, authenticated;

-- ─── 구독 규칙 전체 교체 ─────────────────────────────────────────────────────
create or replace function public.replace_meeting_area_notify_rules(p_app_user_id text, p_rules jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  el jsonb;
  v_rn text;
  v_cid text;
  v_en boolean;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;

  select p.id into v_pid from public.profiles p where p.app_user_id = trim(p_app_user_id) limit 1;
  if v_pid is null then
    perform public.ensure_profile_minimal(p_app_user_id);
    select p.id into v_pid from public.profiles p where p.app_user_id = trim(p_app_user_id) limit 1;
  end if;
  if v_pid is null then
    raise exception 'profile not found';
  end if;

  delete from public.profile_meeting_area_notify_rules where profile_id = v_pid;

  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    return;
  end if;

  for el in select value from jsonb_array_elements(p_rules) as t(value)
  loop
    v_rn := nullif(trim(coalesce(el->>'region_norm', '')), '');
    v_cid := nullif(trim(coalesce(el->>'category_id', '')), '');
    v_en := coalesce((el->>'enabled')::boolean, true);
    if v_rn is null or v_cid is null then
      continue;
    end if;
    if length(v_rn) > 80 or length(v_cid) > 80 then
      continue;
    end if;
    if position(chr(10) in v_rn) > 0 or position(chr(13) in v_rn) > 0 then
      continue;
    end if;
    if position(chr(10) in v_cid) > 0 or position(chr(13) in v_cid) > 0 then
      continue;
    end if;
    if not v_en then
      continue;
    end if;

    insert into public.profile_meeting_area_notify_rules (profile_id, region_norm, category_id, enabled)
    values (v_pid, v_rn, v_cid, true)
    on conflict (profile_id, region_norm, category_id)
    do update set enabled = excluded.enabled, updated_at = now();
  end loop;
end;
$$;

revoke all on function public.replace_meeting_area_notify_rules(text, jsonb) from public;
grant execute on function public.replace_meeting_area_notify_rules(text, jsonb) to anon, authenticated;

-- ─── Fan-out: service_role 전용 ───────────────────────────────────────────
create or replace function public.list_app_user_ids_for_meeting_area_notify(p_meeting_id uuid)
returns table (app_user_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
  v_pub boolean;
  v_region text;
  v_cat text;
begin
  if coalesce(auth.jwt() ->> 'role', '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select m.created_by_profile_id, m.is_public, nullif(trim(m.feed_region_norm), ''), nullif(trim(m.category_id), '')
  into v_host, v_pub, v_region, v_cat
  from public.meetings m
  where m.id = p_meeting_id
  limit 1;

  if v_host is null or coalesce(v_pub, false) <> true then
    return;
  end if;
  if v_region is null or length(v_region) = 0 then
    return;
  end if;

  return query
  select distinct pr.app_user_id::text
  from public.profile_meeting_area_notify_rules r
  inner join public.profiles pr on pr.id = r.profile_id
  where r.enabled = true
    and coalesce(trim(pr.app_user_id), '') <> ''
    and pr.fcm_token is not null
    and length(trim(pr.fcm_token)) > 0
    and pr.id is distinct from v_host
    and (r.region_norm = '*' or r.region_norm = v_region)
    and (
      r.category_id = '*'
      or (v_cat is not null and r.category_id = v_cat)
      or (v_cat is null and r.category_id = '*')
    );
end;
$$;

revoke all on function public.list_app_user_ids_for_meeting_area_notify(uuid) from public;
grant execute on function public.list_app_user_ids_for_meeting_area_notify(uuid) to service_role;

notify pgrst, 'reload schema';
