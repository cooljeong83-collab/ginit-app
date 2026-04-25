-- 0017 적용 후에도 PostgREST가 RPC를 못 찾는 경우(schema cache) 대비: 함수 재정의 + 캐시 리로드.
-- 원격 DB에 0017이 빠졌다면 이 파일만으로도 함수가 생성됩니다.

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

notify pgrst, 'reload schema';
