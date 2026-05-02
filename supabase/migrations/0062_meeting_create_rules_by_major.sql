-- 대분류별 모임 생성 상한 — app_policies + ledger_meeting_create 검증.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting_create',
  'rules_by_major',
  '{"_default":{"capacity_max":100,"membership_fee_won_max":100000,"min_participants_floor":2}}'::jsonb,
  true,
  'ledger_meeting_create: _default 와 meeting_categories.major_code 키 객체를 얕게 병합(||). capacity_max는 정원 999 미만일 때만 적용.'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = now();

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
  v_major_code text := null;
  v_root jsonb;
  v_default jsonb;
  v_major_part jsonb;
  v_rules jsonb;
  v_cap_max int;
  v_fee_max int;
  v_min_floor int;
  v_mc jsonb;
  v_settlement text;
  v_fee numeric;
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

  if trim(v_cat_id) = '' then
    raise exception '카테고리(categoryId)가 필요합니다.';
  end if;

  select nullif(trim(mc.major_code), '') into v_major_code
  from public.meeting_categories mc
  where mc.id = v_cat_id
  limit 1;

  v_root := coalesce(public.get_policy_jsonb('meeting_create', 'rules_by_major'), '{}'::jsonb);
  if jsonb_typeof(v_root->'_default') = 'object' then
    v_default := v_root->'_default';
  else
    v_default := '{}'::jsonb;
  end if;
  if v_major_code is not null and v_major_code <> '' then
    if (v_root ? v_major_code) and jsonb_typeof(v_root->v_major_code) = 'object' then
      v_major_part := v_root->v_major_code;
    elsif (v_root ? upper(v_major_code)) and jsonb_typeof(v_root->upper(v_major_code)) = 'object' then
      v_major_part := v_root->upper(v_major_code);
    else
      v_major_part := '{}'::jsonb;
    end if;
  else
    v_major_part := '{}'::jsonb;
  end if;
  v_rules := v_default || v_major_part;

  v_cap_max := coalesce(
    case jsonb_typeof(v_rules->'capacity_max')
      when 'number' then (v_rules->>'capacity_max')::int
      else null
    end,
    100
  );
  v_fee_max := coalesce(
    case jsonb_typeof(v_rules->'membership_fee_won_max')
      when 'number' then (v_rules->>'membership_fee_won_max')::int
      else null
    end,
    100000
  );
  v_min_floor := coalesce(
    case jsonb_typeof(v_rules->'min_participants_floor')
      when 'number' then (v_rules->>'min_participants_floor')::int
      else null
    end,
    2
  );

  if v_pub and v_min is not null and v_min < v_min_floor then
    raise exception using message = format('공개 모임 최소 인원은 %s명 이상이어야 합니다.', v_min_floor);
  end if;

  if v_cap < 999 and v_cap > v_cap_max then
    raise exception using message = format('정원은 %s명 이하로 설정해 주세요. (무제한은 그대로 사용 가능)', v_cap_max);
  end if;

  v_mc := p_doc->'meetingConfig';
  if v_mc is not null and jsonb_typeof(v_mc) = 'object' then
    v_settlement := upper(coalesce(nullif(trim(v_mc->>'settlement'), ''), ''));
    if v_settlement = 'MEMBERSHIP_FEE' and jsonb_typeof(v_mc->'membershipFeeWon') = 'number' then
      v_fee := (v_mc->>'membershipFeeWon')::numeric;
      if v_fee is not null and v_fee > v_fee_max then
        raise exception using message = format('회비는 %s원 이하로 설정해 주세요.', v_fee_max);
      end if;
    end if;
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

notify pgrst, 'reload schema';
