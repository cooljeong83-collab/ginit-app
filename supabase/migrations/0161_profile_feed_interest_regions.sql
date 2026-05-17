-- 피드(탐색) 관심 지역: 프로필별 등록 목록 + 현재 선택 구 (앱 AsyncStorage 백업용).
-- 공개 모임 생성 알림(profile_meeting_area_notify_matrix)과 별도 도메인입니다.

create table if not exists public.profile_feed_interest_regions (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  region_norms text[] not null default '{}',
  active_region_norm text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profile_feed_interest_regions_touch on public.profile_feed_interest_regions;
create trigger trg_profile_feed_interest_regions_touch
before update on public.profile_feed_interest_regions
for each row execute function public.touch_updated_at();

alter table public.profile_feed_interest_regions enable row level security;
revoke all on public.profile_feed_interest_regions from public;

comment on table public.profile_feed_interest_regions is
  '피드 탐색용 관심 행정구 목록(최대 5) 및 현재 선택 구. 모임 생성 알림 매트릭스와 무관.';

create or replace function public.get_profile_feed_interest_regions(p_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_regions text[];
  v_active text;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    return jsonb_build_object('region_norms', '[]'::jsonb, 'active_region_norm', null);
  end if;

  select p.id into v_pid from public.profiles p where p.app_user_id = trim(p_app_user_id) limit 1;
  if v_pid is null then
    return jsonb_build_object('region_norms', '[]'::jsonb, 'active_region_norm', null);
  end if;

  select f.region_norms, f.active_region_norm
  into v_regions, v_active
  from public.profile_feed_interest_regions f
  where f.profile_id = v_pid;

  if not found then
    v_regions := '{}';
    v_active := null;
  else
    v_regions := coalesce(v_regions, '{}');
    v_active := nullif(trim(v_active), '');
  end if;

  return jsonb_build_object(
    'region_norms', to_jsonb(v_regions),
    'active_region_norm', v_active
  );
end;
$$;

revoke all on function public.get_profile_feed_interest_regions(text) from public;
grant execute on function public.get_profile_feed_interest_regions(text) to anon, authenticated;

create or replace function public.replace_profile_feed_interest_regions(
  p_app_user_id text,
  p_region_norms text[],
  p_active_region_norm text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_rn text;
  v_regions text[] := '{}';
  v_active text;
  v_max int := 5;
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

  if p_region_norms is not null then
    foreach v_rn in array p_region_norms
    loop
      v_rn := nullif(trim(v_rn), '');
      if v_rn is null or v_rn = '*' or length(v_rn) > 80 then
        continue;
      end if;
      if position(chr(10) in v_rn) > 0 or position(chr(13) in v_rn) > 0 then
        continue;
      end if;
      if not (v_rn = any(v_regions)) then
        v_regions := array_append(v_regions, v_rn);
      end if;
      exit when cardinality(v_regions) >= v_max;
    end loop;
  end if;

  v_active := nullif(trim(p_active_region_norm), '');
  if v_active is not null and length(v_active) > 80 then
    v_active := null;
  end if;
  if v_active is not null and not (v_active = any(v_regions)) then
    if cardinality(v_regions) > 0 then
      v_active := v_regions[1];
    else
      v_active := null;
    end if;
  end if;

  delete from public.profile_feed_interest_regions where profile_id = v_pid;

  if cardinality(v_regions) = 0 then
    return;
  end if;

  insert into public.profile_feed_interest_regions (profile_id, region_norms, active_region_norm)
  values (v_pid, v_regions, v_active);
end;
$$;

revoke all on function public.replace_profile_feed_interest_regions(text, text[], text) from public;
grant execute on function public.replace_profile_feed_interest_regions(text, text[], text) to anon, authenticated;
