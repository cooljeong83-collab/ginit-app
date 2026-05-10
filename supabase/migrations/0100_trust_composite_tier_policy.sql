-- 복합 평판 등급(10단계): gTrust·G-Level·누적 gXp 각각 1~10 환산 후 min(bottleneck).
-- 앱은 `getPolicy('trust','composite_tier')` 및 `compositeReputationTier`와 동기.
-- policy_value UTF-8 이모지는 DB·클라이언트 인코딩이 UTF-8임을 전제로 합니다.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values
  (
    'trust',
    'composite_tier',
    $$
    {
      "trust_edges": [10, 20, 30, 40, 50, 60, 70, 80, 90],
      "level_mode": "linear_max",
      "max_level": 50,
      "xp_edges": [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000],
      "tiers": [
        { "step": 1, "label": "씨앗", "emoji": "🌱" },
        { "step": 2, "label": "새싹", "emoji": "🌿" },
        { "step": 3, "label": "줄기", "emoji": "🪴" },
        { "step": 4, "label": "잎", "emoji": "🍃" },
        { "step": 5, "label": "가지", "emoji": "🌳" },
        { "step": 6, "label": "숲", "emoji": "🌲" },
        { "step": 7, "label": "산", "emoji": "⛰️" },
        { "step": 8, "label": "별", "emoji": "✨" },
        { "step": 9, "label": "달", "emoji": "🌙" },
        { "step": 10, "label": "태양", "emoji": "☀️" }
      ],
      "restricted": { "force_step": 1, "label": "제한", "emoji": "🔒" }
    }
    $$::jsonb,
    true,
    '복합 평판(1~10): trust_edges·xp_edges는 길이 9의 오름차순 임계(미만이면 해당 단계, 마지막 구간 이상이면 10). level_mode linear_max일 때 단계=ceil(g_level*10/max_level), g_level은 1~max_level로 간주. 최종 단계=min(신뢰단계,레벨단계,XP단계). is_restricted이면 restricted의 force_step·label·emoji로 고정 표시. emoji는 짧은 문자열(과도한 길이는 앱에서 폴백).'
  )
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  description = excluded.description,
  is_active = true;
