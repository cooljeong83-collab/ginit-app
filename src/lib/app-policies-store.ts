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
  meeting: { overlap_hours: 3, map_radius_km: 5 },
  xp: { meeting_confirm: 50, meeting_vote: 20 },
  trust: {
    /** 서버 `ensure_profile_minimal`이 신규 `g_trust`에 사용(폴백). */
    default_score: 100,
    penalty_noshow: { xp: -100, trust: -50, restricted_below: 30 },
    penalty_late_cancel: { xp: -30, trust: -10 },
    penalty_report_approved: { trust: -20, restricted_below: 30 },
    recovery_checkin: { streak_need: 3, trust_delta: 5, cap: 100 },
    min_join_score: 70,
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
