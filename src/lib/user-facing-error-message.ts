import { labelForUserReportReasonCode } from '@/src/features/user-report/user-report-reasons';

const ACCOUNT_WITHDRAWN_MESSAGE =
  '탈퇴한 계정입니다. 다시 가입하려면 고객센터에 문의해 주세요.';
const ACCOUNT_SUSPENDED_MESSAGE =
  '운영 정책에 따라 이용이 중지된 계정입니다. 문의가 필요하면 고객센터로 연락해 주세요.';

const GENERIC_RETRY =
  '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';

function hasHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

/**
 * Supabase RPC·클라이언트 예외 등 영어/코드 문자열을 사용자용 한국어로 바꿉니다.
 * 이미 한글이 포함되면 원문을 유지합니다(서버 `raise exception '…'` 메시지 등).
 */
export function toUserFacingErrorMessage(raw: string, pgCode?: string): string {
  const t = raw.trim();
  if (!t) return GENERIC_RETRY;
  if (hasHangul(t)) return t;

  const m = t.toLowerCase();
  const c = (pgCode ?? '').trim().toLowerCase();

  if (m === 'withdrawn') return ACCOUNT_WITHDRAWN_MESSAGE;
  if (m === 'suspended') return ACCOUNT_SUSPENDED_MESSAGE;
  if (m === 'forbidden' || m === 'not_admin') return '계정을 확인할 수 없어요.';
  if (m === 'invalid_user') return '사용자 정보가 없습니다.';

  if (
    m === 'harassment' ||
    m === 'spam' ||
    m === 'fake_profile' ||
    m === 'inappropriate' ||
    m === 'scam' ||
    m === 'other'
  ) {
    return labelForUserReportReasonCode(m);
  }

  if (m.includes('withdraw_rejoin') || m.includes('can_reactivate') || m.includes('reactivate_withdrawn')) {
    return '탈퇴 후 재가입 대기 기간이 남아 있어요. 잠시 후 다시 시도해 주세요.';
  }
  if (m.includes('withdraw_anonymize') || m.includes('withdrawn_profile')) {
    return '탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.';
  }
  if (m.includes('duplicate_report')) return '이미 접수된 신고가 검토 중이에요.';
  if (m.includes('cannot_report_self')) return '본인은 신고할 수 없어요.';
  if (m.includes('not_authenticated') || m.includes('profile_not_found')) {
    return '로그인이 필요해요.';
  }
  if (m.includes('not_found')) return '요청한 정보를 찾을 수 없어요.';
  if (m.includes('invalid_reason_code')) return '신고 사유를 선택해 주세요.';

  if (m.includes('_failed') || m.includes('pgrst') || c === 'pgrst202' || m.includes('schema cache')) {
    return GENERIC_RETRY;
  }

  return GENERIC_RETRY;
}

/** 어드민 신고 처리 RPC 오류 — PostgREST·DB 예외 코드를 구체 메시지로 */
export function mapAdminResolveUserReportError(message: string, code?: string): string {
  const m = message.trim().toLowerCase();
  const c = (code ?? '').trim().toLowerCase();

  if (m.includes('invalid_approval_action')) {
    return '승인 유형(패널티·이용 중지)을 확인해 주세요.';
  }
  if (m.includes('reported_profile_not_found') || m.includes('profile not found')) {
    return '피신고자 프로필을 찾을 수 없어요.';
  }
  if (m.includes('not_found')) return '신고 내역을 찾을 수 없어요.';
  if (m.includes('not_admin') || m.includes('forbidden')) {
    return '운영자만 처리할 수 있어요.';
  }
  if (m.includes('invalid_status')) return '처리 상태가 올바르지 않아요.';
  if (
    m.includes('could not find the function') ||
    m.includes('schema cache') ||
    c === 'pgrst202' ||
    c === '42883'
  ) {
    return '서버에 최신 신고 처리 기능이 반영되지 않았을 수 있어요. DB 마이그레이션(0204) 적용 후 다시 시도해 주세요.';
  }
  if (m.includes('approval_action') && m.includes('does not exist')) {
    return '서버 DB에 approval_action 컬럼이 없어요. 마이그레이션(0199·0204) 적용이 필요해요.';
  }

  return toUserFacingErrorMessage(message, code);
}
