-- 장소 인증 미완료 시 로컬 알림(앱 스케줄) 간격·횟수 — app_policies 단일 소스.
update public.app_policies
set
  policy_value = coalesce(policy_value, '{}'::jsonb) || jsonb_build_object(
    'reminder_interval_min', 30,
    'reminder_max_count', 1,
    'reminder_after_scheduled_min', 0
  ),
  description =
    '장소 인증: auth_radius_m·window_*·min_accuracy_m·xp_reward·trust_reward·trust_cap. '
    || 'reminder_interval_min(미인증 시 로컬 알림 간격), reminder_max_count(최대 횟수), '
    || 'reminder_after_scheduled_min(예정 시작 scheduled_at 기준 몇 분 후부터 리마인드 대상).',
  updated_at = now()
where policy_group = 'meeting'
  and policy_key = 'arrival_verify';

notify pgrst, 'reload schema';
