import type {
  PublicMeetingAgeLimit,
  PublicMeetingApprovalType,
  PublicMeetingDetailsConfig,
  PublicMeetingGenderRatio,
  PublicMeetingSettlement,
} from '@/src/lib/meetings';
function isAgeLimit(x: unknown): x is PublicMeetingAgeLimit {
  return x === 'TWENTIES' || x === 'THIRTIES' || x === 'FORTY_PLUS' || x === 'NONE';
}

function isGenderRatio(x: unknown): x is PublicMeetingGenderRatio {
  return x === 'ALL' || x === 'SAME_GENDER_ONLY' || x === 'HALF_HALF';
}

function isSettlement(x: unknown): x is PublicMeetingSettlement {
  return x === 'DUTCH' || x === 'HOST_PAYS' || x === 'INDIVIDUAL' || x === 'MEMBERSHIP_FEE';
}

function isApprovalType(x: unknown): x is PublicMeetingApprovalType {
  return x === 'INSTANT' || x === 'HOST_APPROVAL';
}

/**
 * NLU/Edge가 넘긴 부분 객체를 `PublicMeetingDetailsConfig` 부분으로만 안전하게 병합합니다.
 * 비공개 모임 UI에서는 호출부에서 무시합니다.
 */
export function mergePublicMeetingDetailsFromNluRecord(
  raw: Record<string, unknown> | null,
): { ok: true; value: Partial<PublicMeetingDetailsConfig> } | { ok: false } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false };
  }
  const out: Partial<PublicMeetingDetailsConfig> = {};

  if (Array.isArray(raw.ageLimit)) {
    const xs = raw.ageLimit.filter(isAgeLimit);
    if (xs.length > 0) {
      if (xs.includes('NONE')) {
        out.ageLimit = ['NONE'];
      } else {
        out.ageLimit = xs;
      }
    }
  }

  if (isGenderRatio(raw.genderRatio)) {
    out.genderRatio = raw.genderRatio;
  }

  if (isSettlement(raw.settlement)) {
    out.settlement = raw.settlement;
  }

  if (typeof raw.membershipFeeWon === 'number' && Number.isFinite(raw.membershipFeeWon)) {
    out.membershipFeeWon = Math.max(0, Math.min(100_000, Math.trunc(raw.membershipFeeWon)));
  }

  if (typeof raw.minGLevel === 'number' && Number.isFinite(raw.minGLevel)) {
    out.minGLevel = Math.max(1, Math.min(50, Math.trunc(raw.minGLevel)));
  }

  if (typeof raw.minGTrust === 'number' && Number.isFinite(raw.minGTrust)) {
    out.minGTrust = Math.max(0, Math.min(100, Math.trunc(raw.minGTrust)));
  } else if (raw.minGTrust === null) {
    out.minGTrust = null;
  }

  if (isApprovalType(raw.approvalType)) {
    out.approvalType = raw.approvalType;
  }

  if (raw.requestMessageEnabled === true || raw.requestMessageEnabled === false) {
    out.requestMessageEnabled = raw.requestMessageEnabled;
  }

  if (Object.keys(out).length === 0) {
    return { ok: false };
  }

  return { ok: true, value: out };
}

/** 부분 병합 — 기본값 위에 NLU 필드만 덮어씀 */
export function applyPartialPublicMeetingDetails(
  base: PublicMeetingDetailsConfig,
  partial: Partial<PublicMeetingDetailsConfig> | null,
): PublicMeetingDetailsConfig {
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    ageLimit: partial.ageLimit ?? base.ageLimit,
  };
}
