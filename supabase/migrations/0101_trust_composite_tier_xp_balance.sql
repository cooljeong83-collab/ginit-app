-- 복합 평판: 지닛 XP 적립(확정 50·투표 20, 레벨당 누적 200)에 맞춰 xp_edges·level 축(max_level) 조정.
-- 기존 0100 시드가 적용된 환경은 본 파일의 on conflict로 갱신됩니다.

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values
  (
    'trust',
    'composite_tier',
    $$
    {
      "trust_edges": [10, 20, 30, 40, 50, 60, 70, 80, 90],
      "level_mode": "linear_max",
      "max_level": 28,
      "xp_edges": [200, 450, 700, 1100, 1600, 2400, 3600, 5200, 7600],
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
    'composite_tier v2: xp_edges는 20·50 배수 근처로 초반 구간을 촘촘히(첫 구간 약 4투표 또는 소수 확정 수준). level_mode linear_max의 max_level은 복합 표시용으로 실제 최대 레벨(50)과 별도이며, g_level은 1~max_level로 클램프 후 ceil(g_level*10/max_level)로 1~10 환산(초반 등급 상승이 누적 XP·레벨 곡선과 맞도록 28 권장). trust_edges는 기존과 동일.'
  )
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  description = excluded.description,
  is_active = true;
