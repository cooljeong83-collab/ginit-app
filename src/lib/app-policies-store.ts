/**
 * 중앙 정책 캐시 — `AppPoliciesProvider`가 Supabase `app_policies`를 불러와 채웁니다.
 * 비즈니스 코드는 DB를 직접 호출하지 말고 `getPolicy` / `getPolicyNumeric`을 사용하세요.
 */

export type AppPolicyCacheRow = {
  policy_group: string;
  policy_key: string;
  policy_value: unknown;
  is_active: boolean;
  description?: string | null;
};

type PolicyEntry = { value: unknown; isActive: boolean };

/** 오프라인·마이그레이션 전 기본값(서버 시드와 맞출 것) */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  account: {
    /** `0114_withdraw_rejoin_wait_policy.sql` 시드와 동일 — 탈퇴 후 재가입 가능 대기 기간(일) */
    withdraw_rejoin_wait_days: 0,
  },
  /** `0117_settlement_show_cta_after_start_hours.sql` 시드와 동일 */
  settlement: {
    show_settle_cta_after_start_hours: 1,
  },
  meeting: {
    /** `0121_meeting_overlap_hours_policy_2.sql` 시드와 동일 — 생성/참여 겹침 방지 기준 시간 */
    overlap_hours: 2,
    /** `0128_meeting_home_list_ongoing_duration_hours_6.sql` 시드와 동일 — 참여중·종료 탭 분리 기준 시간 */
    list_ongoing_duration_hours: 6,
    map_radius_km: 5,
    /** `0102_meeting_arrival_verify.sql` 시드와 동일 의미 */
    arrival_verify: {
      auth_radius_m: 120,
      guest_arrival_pill_visible_before_min: 30,
      notice_before_min: 30,
      window_before_min: 30,
      window_after_min: 180,
      min_accuracy_m: 50,
      xp_reward: 15,
      trust_reward: 2,
      trust_cap: 100,
      reminder_interval_min: 30,
      reminder_max_count: 1,
      reminder_after_scheduled_min: 0,
    },
    /** `0172_meeting_place_review_rewards_policy.sql` — 정산 완료 후 장소 후기 최초 제출 보상 */
    place_review: {
      xp_reward: 10,
      trust_reward: 3,
      trust_cap: 100,
    },
  },
  meeting_create: {
    /** `0123_meeting_create_min_schedule_lead_policy.sql` 시드와 동일 — 0이면 과거 시각만 차단 */
    min_schedule_lead_minutes: 0,
    rules_by_major: {
      _default: {
        capacity_max: 100,
        membership_fee_won_max: 100_000,
        min_participants_floor: 2,
      },
    },
    nlu_blocked: {
      phrases: ['마약', '필로폰', '대마', '코카인', '히로뽕', '엑스터시', '게이모임'],
      userMessage:
        '이 내용으로는 모임을 만들 수 없어요. 커뮤니티 가이드에 맞는 모임만 만들 수 있어요.',
    },
  },
  xp: { meeting_confirm: 50, meeting_vote: 20 },
  agentic_guide: {
    meeting_habits: {
      lightning_max_gap_days: 1,
      roll_weeks: 8,
      weight_confirmed: 5,
      weight_user_vote: 3,
      weight_tally: 1,
      weight_display: 1,
    },
  },
  trust: {
    /** 서버 `ensure_profile_minimal`이 신규 `g_trust`에 사용(폴백). */
    default_score: 100,
    /** gTrust 등급 구간 — DB `app_policies`와 동일 키·의미 유지 */
    tier_thresholds: { restricted_lt: 30, caution_lt: 50, normal_lt: 80 },
    penalty_noshow: { xp: -100, trust: -50, restricted_below: 30 },
    penalty_late_cancel: { xp: -30, trust: -10 },
    /** 확정 일정 모임에서 참여자 나가기(모임당 1회, Supabase RPC) */
    penalty_leave_confirmed: { xp: -30, trust: -12, restricted_below: 30 },
    /** `0111` — outer 이내·시작 전에 패널티 후보, inner 이내는 강한 티어(leave/host_unconfirm RPC) */
    penalty_near_meeting_cancel_window_hours: { outer_hours: 2, inner_hours: 1 },
    /** 예정 시작 outer~inner 구간 퇴장·취소 시(전체 패널티보다 약함) */
    penalty_leave_confirmed_soft: { xp: -15, trust: -6, restricted_below: 30 },
    penalty_host_unconfirm_confirmed_soft: { xp: -15, trust: -6, restricted_below: 30 },
    /** 호스트 확정 취소(레저) 시 패널티 — `0107` RPC */
    penalty_host_unconfirm_confirmed: { xp: -30, trust: -12, restricted_below: 30 },
    penalty_report_approved: { trust: -20, restricted_below: 30 },
    recovery_checkin: { streak_need: 3, trust_delta: 5, cap: 100 },
    min_join_score: 70,
    /** 복합 평판 10단계 — DB `0101_trust_composite_tier_xp_balance`와 동기 */
    composite_tier: {
      trust_edges: [10, 20, 30, 40, 50, 60, 70, 80, 90],
      level_mode: 'linear_max',
      max_level: 28,
      xp_edges: [200, 450, 700, 1100, 1600, 2400, 3600, 5200, 7600],
      tiers: [
        { step: 1, label: '씨앗', emoji: '🌱' },
        { step: 2, label: '새싹', emoji: '🌿' },
        { step: 3, label: '줄기', emoji: '🪴' },
        { step: 4, label: '잎', emoji: '🍃' },
        { step: 5, label: '가지', emoji: '🌳' },
        { step: 6, label: '숲', emoji: '🌲' },
        { step: 7, label: '산', emoji: '⛰️' },
        { step: 8, label: '별', emoji: '✨' },
        { step: 9, label: '달', emoji: '🌙' },
        { step: 10, label: '태양', emoji: '☀️' },
      ],
      restricted: { force_step: 1, label: '제한', emoji: '🔒' },
    },
  },
};

let cache: Record<string, Record<string, PolicyEntry>> = {};

function defaultTreeValue(group: string, key: string): unknown {
  return DEFAULTS[group]?.[key];
}

export function resetAppPoliciesCacheForTests(): void {
  cache = {};
}

/** 활성 정책만 캐시에 반영합니다. */
export function hydrateAppPoliciesFromRows(rows: readonly AppPolicyCacheRow[]): void {
  const next: Record<string, Record<string, PolicyEntry>> = {};
  for (const r of rows) {
    const g = typeof r.policy_group === 'string' ? r.policy_group.trim() : '';
    const k = typeof r.policy_key === 'string' ? r.policy_key.trim() : '';
    if (!g || !k) continue;
    if (!next[g]) next[g] = {};
    next[g][k] = { value: r.policy_value, isActive: r.is_active !== false };
  }
  cache = next;
}

/**
 * 정책 JSON 값 조회. 비활성(`is_active=false`)이면 내장 기본 → 인자 `defaultValue`.
 */
export function getPolicy<T = unknown>(group: string, key: string, defaultValue: T): T {
  const g = group.trim();
  const k = key.trim();
  const entry = cache[g]?.[k];
  if (entry && entry.isActive === false) {
    const fb = defaultTreeValue(g, k);
    return (fb !== undefined && fb !== null ? fb : defaultValue) as T;
  }
  if (entry && entry.value !== undefined && entry.value !== null) {
    return entry.value as T;
  }
  const fb = defaultTreeValue(g, k);
  if (fb !== undefined && fb !== null) return fb as T;
  return defaultValue;
}

/** 스칼라 숫자 정책(숫자 JSON 또는 `{ "value": n }`) */
export function getPolicyNumeric(group: string, key: string, defaultValue: number): number {
  const raw = getPolicy<unknown>(group, key, defaultValue);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (raw && typeof raw === 'object' && 'value' in (raw as object)) {
    const n = Number((raw as { value?: unknown }).value);
    if (Number.isFinite(n)) return n;
  }
  return defaultValue;
}
