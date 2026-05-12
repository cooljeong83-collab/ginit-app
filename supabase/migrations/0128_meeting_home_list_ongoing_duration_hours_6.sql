insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting',
  'list_ongoing_duration_hours',
  '6'::jsonb,
  true,
  '홈 참여중·종료 탭 분리 기준: 모임 시작 시각부터 이 값(시간)까지는 참여중 탭에 표시하고, 그보다 과거인 모임은 종료 탭에 표시합니다.'
)
on conflict (policy_group, policy_key) do update set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

notify pgrst, 'reload schema';
