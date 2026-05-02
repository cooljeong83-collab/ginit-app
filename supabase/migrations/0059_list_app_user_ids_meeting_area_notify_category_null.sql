-- 공개 모임 category_id 가 비어 있을 때도 «지역+카테고리» 매트릭스 구독자에게 알림이 가도록 정합성 수정.
-- 앱은 더 이상 category_ids 에 `*` 를 넣지 않으므로, v_cat IS NULL 인 경우 기존 조건으로는 구독자 0명이 됨.

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
      v_cat is null
      or '*' = any(nm.category_ids)
      or v_cat = any(nm.category_ids)
    );
end;
$$;

revoke all on function public.list_app_user_ids_for_meeting_area_notify(uuid) from public;
grant execute on function public.list_app_user_ids_for_meeting_area_notify(uuid) to service_role;

notify pgrst, 'reload schema';
