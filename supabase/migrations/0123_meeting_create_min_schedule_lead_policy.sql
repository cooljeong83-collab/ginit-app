insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting_create',
  'min_schedule_lead_minutes',
  '0'::jsonb,
  true,
  '모임 생성/일시 후보 등록 시 현재 시각부터 최소 몇 분 이후의 일시만 허용할지 설정합니다. 0이면 과거 시각만 차단합니다.'
)
on conflict (policy_group, policy_key) do update
set policy_value = excluded.policy_value,
    is_active = excluded.is_active,
    description = excluded.description,
    updated_at = now();

notify pgrst, 'reload schema';
