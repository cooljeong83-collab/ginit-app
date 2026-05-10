-- 장소 인증 가능 시간창: 예정 시작 30분 전부터 시작 후 3시간까지.
update public.app_policies
set
  policy_value =
    coalesce(policy_value, '{}'::jsonb)
    || jsonb_build_object(
      'window_before_min', 30,
      'window_after_min', 180
    ),
  description =
    coalesce(description, '')
    || ' window_before_min/window_after_min: 장소 인증 가능 시간창(예정 시작 30분 전부터 시작 후 180분까지).',
  updated_at = now()
where policy_group = 'meeting'
  and policy_key = 'arrival_verify';

notify pgrst, 'reload schema';
