-- 확정 일정 ±N시간(기본 3h, 우수 유저 2h) 중복 방지 — 클라이언트·RPC에서 호출합니다.
-- `meetings.schedule_confirmed` + `scheduled_at` 기준, `meeting_participants`로 사용자 소속만 집계합니다.

create or replace function public.assert_no_confirmed_schedule_overlap(
  p_app_user_id text,
  p_start timestamptz,
  p_buffer_hours numeric default 3,
  p_exclude_meeting_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int;
  v_buf numeric;
  v_msg text;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' or p_start is null then
    return;
  end if;

  v_buf := case when p_buffer_hours is null or p_buffer_hours <= 0 then 3::numeric else p_buffer_hours end;

  select count(*)::int into v_cnt
  from public.meetings mt
  inner join public.meeting_participants mp on mp.meeting_id = mt.id
  inner join public.profiles pr on pr.id = mp.profile_id
  where pr.app_user_id = trim(p_app_user_id)
    and mt.schedule_confirmed is true
    and mt.scheduled_at is not null
    and (p_exclude_meeting_id is null or mt.id <> p_exclude_meeting_id)
    and mt.scheduled_at >= (p_start - make_interval(mins => round(v_buf * 60.0)))
    and mt.scheduled_at <= (p_start + make_interval(mins => round(v_buf * 60.0)));

  if v_cnt > 0 then
    if v_buf <= 2.000001 then
      v_msg := '이미 해당 시간대 근처(2시간 이내)에 다른 확정된 약속이 있습니다.';
    else
      v_msg := '이미 해당 시간대 근처(3시간 이내)에 다른 확정된 약속이 있습니다.';
    end if;
    raise exception '%', v_msg;
  end if;
end;
$$;

revoke all on function public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid) from public;
grant execute on function public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid) to anon, authenticated;
