import { getPolicy } from '@/src/lib/app-policies-store';
import { MEETING_PARTICIPANT_MIN } from '@/src/lib/meetings';

export type ResolvedMeetingCreateRules = {
  capacityMax: number;
  membershipFeeWonMax: number;
  minParticipantsFloor: number;
};

const FALLBACK: ResolvedMeetingCreateRules = {
  capacityMax: 100,
  membershipFeeWonMax: 100_000,
  minParticipantsFloor: 2,
};

function readPositiveInt(v: unknown, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return d;
  return Math.trunc(n);
}

function majorPatchFromRoot(root: Record<string, unknown>, mk: string): Record<string, unknown> {
  if (!mk) return {};
  const direct = root[mk];
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, unknown>;
  const up = mk.toUpperCase();
  const alt = root[up];
  if (alt && typeof alt === 'object' && !Array.isArray(alt)) return alt as Record<string, unknown>;
  return {};
}

function mergeRuleObjects(raw: unknown, majorCode: string | null | undefined): Record<string, unknown> {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const def =
    root._default && typeof root._default === 'object' && !Array.isArray(root._default)
      ? (root._default as Record<string, unknown>)
      : {};
  const mk = (majorCode ?? '').trim();
  const maj = majorPatchFromRoot(root, mk);
  return { ...def, ...maj };
}

/** `meeting_categories.major_code` 기준 `meeting_create.rules_by_major` 병합(서버 RPC와 동일 얕은 병합). */
export function resolveMeetingCreateRules(majorCode: string | null | undefined): ResolvedMeetingCreateRules {
  const raw = getPolicy<unknown>('meeting_create', 'rules_by_major', {});
  const m = mergeRuleObjects(raw, majorCode);
  let capacityMax = readPositiveInt(m.capacity_max, FALLBACK.capacityMax);
  let minParticipantsFloor = readPositiveInt(m.min_participants_floor, FALLBACK.minParticipantsFloor);
  minParticipantsFloor = Math.max(MEETING_PARTICIPANT_MIN, minParticipantsFloor);
  /** 정책 오타 등으로 하한이 상한을 넘지 않게 */
  minParticipantsFloor = Math.min(minParticipantsFloor, capacityMax);
  return {
    capacityMax,
    membershipFeeWonMax: readPositiveInt(m.membership_fee_won_max, FALLBACK.membershipFeeWonMax),
    minParticipantsFloor,
  };
}
