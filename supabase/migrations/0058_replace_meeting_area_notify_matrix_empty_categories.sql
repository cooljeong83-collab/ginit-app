-- 카테고리를 하나도 선택하지 않아도 관심 지역(region_norms)만 저장할 수 있게 합니다.
-- (앱에서 «전체» 토글 OFF 시 category_ids 가 비어도 행을 유지)

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
      if v_ci is null or v_ci = '*' or length(v_ci) > 80 then
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

  if cardinality(v_regions) = 0 then
    return;
  end if;

  insert into public.profile_meeting_area_notify_matrix (profile_id, region_norms, category_ids)
  values (v_pid, v_regions, v_cats);
end;
$$;

revoke all on function public.replace_meeting_area_notify_matrix(text, text[], text[]) from public;
grant execute on function public.replace_meeting_area_notify_matrix(text, text[], text[]) to anon, authenticated;

notify pgrst, 'reload schema';
