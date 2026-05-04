-- 모임 생성 NLU: 금지어·차단 메시지(운영이 `policy_value`에서 조정)
insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values
  (
    'meeting_create',
    'nlu_blocked',
    jsonb_build_object(
      'phrases',
      array['마약', '필로폰', '대마', '코카인', '히로뽕', '엑스터시', '게이모임']::text[],
      'userMessage',
      '이 내용으로는 모임을 만들 수 없어요. 커뮤니티 가이드에 맞는 모임만 만들 수 있어요.'
    ),
    true,
    'NLU 입력 선검사: phrases 부분일치(정규화된 텍스트) 시 생성 차단. 운영에서 phrases·userMessage 수정 가능.'
  )
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

notify pgrst, 'reload schema';
