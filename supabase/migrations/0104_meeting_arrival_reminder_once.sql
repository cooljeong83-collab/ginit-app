-- 장소 인증 리마인더: 로컬 알림은 1회만(중복 스케줄 방지 정책).
update public.app_policies
set
  policy_value = coalesce(policy_value, '{}'::jsonb) || jsonb_build_object('reminder_max_count', 1),
  updated_at = now()
where policy_group = 'meeting'
  and policy_key = 'arrival_verify';

notify pgrst, 'reload schema';
