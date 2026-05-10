/**
 * 복합 평판 등급(10단계): gTrust·G-Level·누적 gXp → 각 1~10 → min. 제한 계정은 정책 `restricted` 고정.
 * 정책 키: `trust.composite_tier` (app_policies). 기본값은 DB 시드·`app-policies-store` DEFAULTS와 동기.
 */
import { getPolicy } from '@/src/lib/app-policies-store';
import {
  effectiveGLevel,
  effectiveGTrust,
  effectiveGXp,
  isUserTrustRestricted,
} from '@/src/lib/ginit-trust';
import type { UserProfile } from '@/src/lib/user-profile';

export type CompositeTierRow = { step: number; label: string; emoji: string };

export type CompositeTierRestrictedPolicy = {
  force_step: number;
  label: string;
  emoji: string;
};

export type CompositeTierPolicyValue = {
  trust_edges: number[];
  level_mode: 'linear_max';
  max_level: number;
  xp_edges: number[];
  tiers: CompositeTierRow[];
  restricted: CompositeTierRestrictedPolicy;
};

/** `getPolicy` 세 번째 인자 및 오프라인 폴백 — `app-policies-store` trust.composite_tier 시드와 동일 유지 */
export const COMPOSITE_TIER_POLICY_FALLBACK: CompositeTierPolicyValue = {
  trust_edges: [10, 20, 30, 40, 50, 60, 70, 80, 90],
  level_mode: 'linear_max',
  /** 복합 표시용; 실제 G-Level 상한(50)과 별도. XP 200/레벨·투표20·확정50에 맞춘 곡선 — DB `0101`과 동기 */
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
};

const EMOJI_FALLBACK = '⭐';
const EMOJI_MAX_CODE_UNITS = 16;

function sanitizeEmoji(raw: unknown): string {
  if (typeof raw !== 'string') return EMOJI_FALLBACK;
  const t = raw.trim();
  if (!t || t.length > EMOJI_MAX_CODE_UNITS) return EMOJI_FALLBACK;
  return t;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function normalizeStrictAscendingEdges(raw: unknown, fallback: readonly number[]): number[] {
  if (!Array.isArray(raw) || raw.length !== 9) return [...fallback];
  const nums = raw.map((x) => (typeof x === 'number' && Number.isFinite(x) ? Math.trunc(x) : NaN));
  if (nums.some((x) => !Number.isFinite(x))) return [...fallback];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! <= nums[i - 1]!) return [...fallback];
  }
  return nums as number[];
}

function normalizeMaxLevel(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return clampInt(raw, 1, 200);
}

function normalizeTiers(raw: unknown, fb: readonly CompositeTierRow[]): CompositeTierRow[] {
  if (!Array.isArray(raw) || raw.length !== 10) return fb.map((r) => ({ ...r }));
  const out: CompositeTierRow[] = [];
  for (let i = 0; i < 10; i++) {
    const row = raw[i];
    const step = i + 1;
    const label =
      row && typeof row === 'object' && typeof (row as { label?: unknown }).label === 'string'
        ? String((row as { label: string }).label).trim() || fb[i]!.label
        : fb[i]!.label;
    const emoji = sanitizeEmoji((row as { emoji?: unknown })?.emoji);
    out.push({ step, label, emoji: emoji || fb[i]!.emoji });
  }
  return out;
}

function normalizeRestricted(raw: unknown, fb: CompositeTierRestrictedPolicy): CompositeTierRestrictedPolicy {
  if (!raw || typeof raw !== 'object') return { ...fb };
  const o = raw as Record<string, unknown>;
  const force =
    typeof o.force_step === 'number' && Number.isFinite(o.force_step) ? clampInt(o.force_step, 1, 10) : fb.force_step;
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : fb.label;
  const emoji = sanitizeEmoji(o.emoji) || fb.emoji;
  return { force_step: force, label, emoji };
}

function parseCompositeTierPolicy(raw: unknown): CompositeTierPolicyValue {
  const fb = COMPOSITE_TIER_POLICY_FALLBACK;
  if (!raw || typeof raw !== 'object') return { ...fb, tiers: fb.tiers.map((r) => ({ ...r })), restricted: { ...fb.restricted } };
  const o = raw as Record<string, unknown>;
  const levelMode = o.level_mode === 'linear_max' ? 'linear_max' : fb.level_mode;
  return {
    trust_edges: normalizeStrictAscendingEdges(o.trust_edges, fb.trust_edges),
    level_mode: levelMode,
    max_level: normalizeMaxLevel(o.max_level, fb.max_level),
    xp_edges: normalizeStrictAscendingEdges(o.xp_edges, fb.xp_edges),
    tiers: normalizeTiers(o.tiers, fb.tiers),
    restricted: normalizeRestricted(o.restricted, fb.restricted),
  };
}

/** 누적 점수(신뢰·XP)를 1~10 단계로 환산: edges[i] 미만이면 단계 i+1, 모두 이상이면 10 */
function decileFromAscendingEdges(score: number, edges: readonly number[]): number {
  const s = Math.max(0, Number.isFinite(score) ? Math.trunc(score) : 0);
  for (let i = 0; i < edges.length; i++) {
    if (s < edges[i]!) return i + 1;
  }
  return 10;
}

function levelStepLinearMax(gLevel: number, maxLevel: number): number {
  const lv = clampInt(gLevel, 1, maxLevel);
  return clampInt(Math.ceil((lv * 10) / maxLevel), 1, 10);
}

export type CompositeReputationTierResult = {
  step: number;
  label: string;
  emoji: string;
  trust: number;
};

export function compositeReputationTier(profile: UserProfile | null | undefined): CompositeReputationTierResult {
  const trust = effectiveGTrust(profile);
  const policy = parseCompositeTierPolicy(
    getPolicy<unknown>('trust', 'composite_tier', COMPOSITE_TIER_POLICY_FALLBACK),
  );

  if (isUserTrustRestricted(profile)) {
    const r = policy.restricted;
    const step = clampInt(r.force_step, 1, 10);
    const row = policy.tiers[step - 1];
    return {
      step,
      label: r.label || row?.label || '제한',
      emoji: sanitizeEmoji(r.emoji) || row?.emoji || EMOJI_FALLBACK,
      trust,
    };
  }

  const tTrust = decileFromAscendingEdges(trust, policy.trust_edges);
  const tXp = decileFromAscendingEdges(effectiveGXp(profile), policy.xp_edges);
  const tLevel = levelStepLinearMax(effectiveGLevel(profile), policy.max_level);
  const step = Math.min(tTrust, tXp, tLevel);
  const row = policy.tiers[step - 1];
  return {
    step,
    label: row?.label ?? `등급 ${step}`,
    emoji: sanitizeEmoji(row?.emoji),
    trust,
  };
}
