-- 모임 생성 알림: «관심 지역» 배열 × «카테고리» 배열 AND 매칭(단일 행/프로필).
-- 기존 profile_meeting_area_notify_rules 는 집계 후 제거합니다.

create table if not exists public.profile_meeting_area_notify_matrix (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  region_norms text[] not null default '{}',
  category_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profile_meeting_area_notify_matrix_touch on public.profile_meeting_area_notify_matrix;
create trigger trg_profile_meeting_area_notify_matrix_touch
before update on public.profile_meeting_area_notify_matrix
for each row execute function public.touch_updated_at();

alter table public.profile_meeting_area_notify_matrix enable row level security;
revoke all on public.profile_meeting_area_notify_matrix from public;

-- 규칙 테이블 → 행렬(손실 허용: 지역·카테고리별 유니크 집합만 보존). 재적용 시 rules 없으면 생략.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'profile_meeting_area_notify_rules'
  ) then
    insert into public.profile_meeting_area_notify_matrix (profile_id, region_norms, category_ids)
    select s.profile_id, s.region_norms, s.category_ids
    from (
      select
        r.profile_id,
        coalesce(
          array_agg(distinct r.region_norm) filter (
            where r.region_norm is not null
              and trim(r.region_norm) <> ''
              and trim(r.region_norm) <> '*'
          ),
          '{}'::text[]
        ) as region_norms,
        coalesce(
          array_agg(distinct r.category_id) filter (
            where r.category_id is not null and trim(r.category_id) <> ''
          ),
          '{}'::text[]
        ) as category_ids
      from public.profile_meeting_area_notify_rules r
      where coalesce(r.enabled, true) = true
      group by r.profile_id
    ) s
    where cardinality(s.region_norms) > 0 and cardinality(s.category_ids) > 0
    on conflict (profile_id) do update set
      region_norms = excluded.region_norms,
      category_ids = excluded.category_ids,
      updated_at = now();
  end if;
end $$;

drop function if exists public.get_meeting_area_notify_rules(text);
drop function if exists public.replace_meeting_area_notify_rules(text, jsonb);

drop table if exists public.profile_meeting_area_notify_rules cascade;

create or replace function public.get_meeting_area_notify_matrix(p_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_regions text[];
  v_cats text[];
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    return jsonb_build_object('region_norms', '[]'::jsonb, 'category_ids', '[]'::jsonb);
  end if;

  select p.id into v_pid from public.profiles p where p.app_user_id = trim(p_app_user_id) limit 1;
  if v_pid is null then
    return jsonb_build_object('region_norms', '[]'::jsonb, 'category_ids', '[]'::jsonb);
  end if;

  select m.region_norms, m.category_ids
  into v_regions, v_cats
  from public.profile_meeting_area_notify_matrix m
  where m.profile_id = v_pid;

  if not found then
    v_regions := '{}';
    v_cats := '{}';
  else
    v_regions := coalesce(v_regions, '{}');
    v_cats := coalesce(v_cats, '{}');
  end if;

  return jsonb_build_object(
    'region_norms', to_jsonb(v_regions),
    'category_ids', to_jsonb(v_cats)
  );
end;
$$;

revoke all on function public.get_meeting_area_notify_matrix(text) from public;
grant execute on function public.get_meeting_area_notify_matrix(text) to anon, authenticated;

create or replace function public.replace_meeting_area_notify_matrix(
  p_app_user_id text,
  p_region_norms text[],
  p_category_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pid uuid;
  v_rn text;
  v_ci text;
  v_regions text[] := '{}';
  v_cats text[] := '{}';
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
      exit when cardinality(v_regions) >= 24;
    end loop;
  end if;

  if p_category_ids is not null then
    foreach v_ci in array p_category_ids
    loop
      v_ci := nullif(trim(v_ci), '');
      if v_ci is null or length(v_ci) > 80 then
        continue;
      end if;
      if position(chr(10) in v_ci) > 0 or position(chr(13) in v_ci) > 0 then
        continue;
      end if;
      if not (v_ci = any(v_cats)) then
        v_cats := array_append(v_cats, v_ci);
      end if;
      exit when cardinality(v_cats) >= 48;
    end loop;
  end if;

  delete from public.profile_meeting_area_notify_matrix where profile_id = v_pid;

  if cardinality(v_regions) = 0 or cardinality(v_cats) = 0 then
    return;
  end if;

  insert into public.profile_meeting_area_notify_matrix (profile_id, region_norms, category_ids)
  values (v_pid, v_regions, v_cats);
end;
$$;

revoke all on function public.replace_meeting_area_notify_matrix(text, text[], text[]) from public;
grant execute on function public.replace_meeting_area_notify_matrix(text, text[], text[]) to anon, authenticated;

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
  from public.profile_meeting_area_notify_matrix nm
  inner join public.profiles pr on pr.id = nm.profile_id
  where coalesce(trim(pr.app_user_id), '') <> ''
    and pr.fcm_token is not null
    and length(trim(pr.fcm_token)) > 0
    and pr.id is distinct from v_host
    and cardinality(coalesce(nm.region_norms, '{}')) > 0
    and cardinality(coalesce(nm.category_ids, '{}')) > 0
    and v_region = any(nm.region_norms)
    and (
      '*' = any(nm.category_ids)
      or (v_cat is not null and v_cat = any(nm.category_ids))
      or (v_cat is null and '*' = any(nm.category_ids))
    );
end;
$$;

revoke all on function public.list_app_user_ids_for_meeting_area_notify(uuid) from public;
grant execute on function public.list_app_user_ids_for_meeting_area_notify(uuid) to service_role;

notify pgrst, 'reload schema';
