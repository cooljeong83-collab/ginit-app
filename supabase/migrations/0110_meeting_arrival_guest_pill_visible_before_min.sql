-- 게스트 모임 상세 하단: 예정 시작 N분 전부터만 장소 인증 pill 표시(그 전에는 퇴장). 앱 `arrival_verify.guest_arrival_pill_visible_before_min`와 정합.
update public.app_policies
set
  policy_value =
    coalesce(policy_value, '{}'::jsonb)
    || jsonb_build_object('guest_arrival_pill_visible_before_min', 30),
  description =
    coalesce(description, '')
    || ' guest_arrival_pill_visible_before_min: 게스트 하단에서 장소 인증 pill을 예정 시작 몇 분 전부터 표시(기본 30).',
  updated_at = now()
where policy_group = 'meeting'
  and policy_key = 'arrival_verify';

notify pgrst, 'reload schema';
