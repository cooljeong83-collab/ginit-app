-- make_interval(mins => …) 는 mins 가 integer 여야 함. round(numeric)는 numeric 이라
-- "function make_interval(mins => numeric) does not exist" 가 납니다.
-- 버퍼(시간)는 numeric * interval 로 계산합니다 (0019 본문과 동일, 표현만 수정).

create or replace function public.assert_no_confirmed_schedule_overlap(
  p_app_user_id text,
  p_start timestamptz,
  p_buffer_hours numeric default null,
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
  v_default_buf numeric;
  v_hours int;
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' or p_start is null then
    return;
  end if;

  v_default_buf := public.get_policy_numeric('meeting', 'overlap_hours', 3::numeric);
  if v_default_buf is null or v_default_buf <= 0 then
    v_default_buf := 3::numeric;
  end if;

  v_buf := case
    when p_buffer_hours is null or p_buffer_hours <= 0 then v_default_buf
    else p_buffer_hours
  end;

  select count(*)::int into v_cnt
  from public.meetings mt
  inner join public.meeting_participants mp on mp.meeting_id = mt.id
  inner join public.profiles pr on pr.id = mp.profile_id
  where pr.app_user_id = trim(p_app_user_id)
    and mt.schedule_confirmed is true
    and mt.scheduled_at is not null
    and (p_exclude_meeting_id is null or mt.id <> p_exclude_meeting_id)
    and mt.scheduled_at >= (p_start - (v_buf * interval '1 hour'))
    and mt.scheduled_at <= (p_start + (v_buf * interval '1 hour'));

  if v_cnt > 0 then
    v_hours := greatest(1, round(v_buf))::int;
    v_msg := format(
      '이미 해당 시간대 근처(%s시간 이내)에 다른 확정된 약속이 있습니다.',
      v_hours
    );
    raise exception '%', v_msg;
  end if;
end;
$$;

revoke all on function public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid) from public;
grant execute on function public.assert_no_confirmed_schedule_overlap(text, timestamptz, numeric, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
