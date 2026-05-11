-- 장소 인증 공지 노출 시작 시간 — app_policies 단일 소스.
-- notice_before_min: 예정 시작 scheduled_at 기준 몇 분 전부터 상단 장소 인증 공지를 노출할지.
-- 예) 30 = 30분 전부터, 0 = 모임 시작 시각부터.

update public.app_policies
set
  policy_value =
    coalesce(policy_value, '{}'::jsonb)
    || jsonb_build_object('notice_before_min', 30),
  description =
    coalesce(description, '')
    || ' notice_before_min: 장소 인증 상단 공지 노출 시작 시점(예정 시작 몇 분 전, 0이면 시작 시각부터).',
  updated_at = now()
where policy_group = 'meeting'
  and policy_key = 'arrival_verify';

notify pgrst, 'reload schema';
