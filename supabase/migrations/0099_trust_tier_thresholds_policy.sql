-- gTrust 등급(제한·주의·보통·우수) 구간 — 앱 `getPolicy('trust','tier_thresholds')` 및 `normalizeTrustTierThresholds`와 동기

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values
  (
    'trust',
    'tier_thresholds',
    '{"restricted_lt":30,"caution_lt":50,"normal_lt":80}'::jsonb,
    true,
    'gTrust 등급 구간(상한 미만 비교, 0~100): restricted_lt 미만 또는 is_restricted → 제한; caution_lt 미만 → 주의; normal_lt 미만 → 보통; normal_lt 이상 → 우수. 반드시 restricted_lt ≤ caution_lt ≤ normal_lt 권장(앱에서 순서 보정).'
  )
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  description = excluded.description,
  is_active = true;
