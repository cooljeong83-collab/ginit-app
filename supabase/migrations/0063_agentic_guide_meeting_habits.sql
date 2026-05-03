-- 에이전트 참여 습관 집계 가중치·번개 간격(클라이언트 `getPolicy('agentic_guide','meeting_habits')` 폴백과 동기)
insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'agentic_guide',
  'meeting_habits',
  jsonb_build_object(
    'lightning_max_gap_days', 1,
    'roll_weeks', 8,
    'weight_confirmed', 5,
    'weight_user_vote', 3,
    'weight_tally', 1,
    'weight_display', 1
  ),
  true,
  '모임 생성 에이전트: 참여 습관 집계 시 확정 장소·본인 투표·득표·표시명 가중치, 번개 판단용 최대 일정 간격(일), 롤링 주 수'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

notify pgrst, 'reload schema';
