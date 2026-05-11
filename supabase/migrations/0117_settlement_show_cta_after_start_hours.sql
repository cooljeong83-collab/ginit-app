-- 정산 CTA 노출: 예정 시작 시각 이후 N시간 경과 후(호스트 전용 UI는 앱에서 판별).
-- 단위: 시간(hours). 정수. 기본 1.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'settlement',
  'show_settle_cta_after_start_hours',
  '1'::jsonb,
  true,
  '모임 예정 시작(scheduledAt 등) 이후 정산하기 배너·CTA를 보여주기까지의 대기 시간(시간). 예: 1이면 시작 1시간 후부터 노출.'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

notify pgrst, 'reload schema';
