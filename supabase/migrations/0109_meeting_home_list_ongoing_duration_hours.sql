-- 홈 내 모임·비공개 목록: 확정 시작 시각 경과 후 "모임 중", N시간 경과 후 "모임 종료" 배지. 앱 `getPolicyNumeric('meeting','list_ongoing_duration_hours',3)`와 정합.
insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting',
  'list_ongoing_duration_hours',
  '3'::jsonb,
  true,
  '내 모임·비공개 홈 목록 배지: 확정 일정 시작 시각 이후 "모임 중"으로 표시하고, 시작 시각으로부터 이 값(시간)이 지나면 "모임 종료"로 표시합니다.'
)
on conflict (policy_group, policy_key) do update set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

notify pgrst, 'reload schema';
