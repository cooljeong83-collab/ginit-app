insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting',
  'overlap_hours',
  '2'::jsonb,
  true,
  '모임 생성 및 참여 시 내가 참여한 기존 모임과 겹침을 막는 기준 시간(hours)'
)
on conflict (policy_group, policy_key) do update
set policy_value = excluded.policy_value,
    is_active = excluded.is_active,
    description = excluded.description,
    updated_at = now();

notify pgrst, 'reload schema';
