-- 일정 확정/확정 취소 시 참여 프로필의 meeting_count ±1 (Supabase meetings 행 기준)
-- Firestore-only 모임은 앱에서 `adjust_profiles_meeting_count_by_app_user_ids` RPC를 별도 호출합니다.

create or replace function public.adjust_profiles_meeting_count_by_app_user_ids(
  p_app_user_ids text[],
  p_delta int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_app_user_ids is null or cardinality(p_app_user_ids) = 0 then
    return;
  end if;
  if p_delta is null or p_delta = 0 then
    return;
  end if;

  update public.profiles p
  set meeting_count = greatest(0, p.meeting_count + p_delta)
  where p.app_user_id in (
    select distinct trim(x)
    from unnest(p_app_user_ids) as t(x)
    where trim(x) is not null
      and trim(x) <> ''
  );
end;
$$;

revoke all on function public.adjust_profiles_meeting_count_by_app_user_ids(text[], int) from public;
grant execute on function public.adjust_profiles_meeting_count_by_app_user_ids(text[], int) to anon, authenticated;

create or replace function public.apply_profiles_meeting_count_on_meeting_schedule_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean;
  v_new boolean;
  v_delta int := 0;
begin
  if tg_op = 'INSERT' then
    v_old := false;
    v_new := coalesce(new.schedule_confirmed, false);
  elsif tg_op = 'UPDATE' then
    v_old := coalesce(old.schedule_confirmed, false);
    v_new := coalesce(new.schedule_confirmed, false);
  else
    return new;
  end if;

  if v_old = false and v_new = true then
    v_delta := 1;
  elsif v_old = true and v_new = false then
    v_delta := -1;
  else
    return new;
  end if;

  update public.profiles p
  set meeting_count = greatest(0, p.meeting_count + v_delta)
  where p.id in (
    select distinct x.pid
    from (
      select mp.profile_id as pid
      from public.meeting_participants mp
      where mp.meeting_id = new.id
        and mp.profile_id is not null
      union
      select new.created_by_profile_id
      where new.created_by_profile_id is not null
    ) x
    where x.pid is not null
  );

  return new;
end;
$$;

drop trigger if exists trg_meetings_meeting_count_schedule on public.meetings;
create trigger trg_meetings_meeting_count_schedule
after insert or update of schedule_confirmed on public.meetings
for each row
execute function public.apply_profiles_meeting_count_on_meeting_schedule_confirm();

notify pgrst, 'reload schema';
