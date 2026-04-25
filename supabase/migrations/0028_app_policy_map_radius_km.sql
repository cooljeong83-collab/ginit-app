-- 지도 탭: 내 위치 기준 공개 모임 탐색 반경(km). 원 오버레이·목록·마커 필터와 앱 `getPolicyNumeric('meeting','map_radius_km',5)` 정합.
insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting',
  'map_radius_km',
  '5'::jsonb,
  true,
  '지도 화면에서 사용자 좌표 기준으로 표시·필터링할 최대 거리(킬로미터). 지도 원 반경과 동일합니다.'
)
on conflict (policy_group, policy_key) do update set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();
