-- 일정 겹침 검사용: 로그인 프로필과 무관하게 app_user_id 기준으로 참여 중인 모임 행을 반환합니다.
-- 클라이언트가 미확정 모임의 `dateCandidates`(extra_data.fs)까지 스캔할 때 사용합니다.

create or replace function public.ledger_list_my_meetings_for_overlap(p_app_user_id text)
returns table (
  meeting_id uuid,
  schedule_confirmed boolean,
  scheduled_at timestamptz,
  schedule_date text,
  schedule_time text,
  fs_doc jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    mt.id,
    coalesce(mt.schedule_confirmed, false),
    mt.scheduled_at,
    coalesce(mt.schedule_date, ''),
    coalesce(mt.schedule_time, ''),
    coalesce(mt.extra_data->'fs', '{}'::jsonb)
  from public.meetings mt
  inner join public.meeting_participants mp on mp.meeting_id = mt.id
  inner join public.profiles pr on pr.id = mp.profile_id
  where pr.app_user_id = trim(p_app_user_id);
$$;

revoke all on function public.ledger_list_my_meetings_for_overlap(text) from public;
grant execute on function public.ledger_list_my_meetings_for_overlap(text) to anon, authenticated;
