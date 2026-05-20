export type UserReportReasonCode =
  | 'harassment'
  | 'spam'
  | 'fake_profile'
  | 'inappropriate'
  | 'scam'
  | 'other';

export type UserReportReasonOption = {
  code: UserReportReasonCode;
  label: string;
};

export const USER_REPORT_REASONS: readonly UserReportReasonOption[] = [
  { code: 'harassment', label: '괴롭힘·욕설' },
  { code: 'spam', label: '스팸·광고' },
  { code: 'fake_profile', label: '허위 프로필' },
  { code: 'inappropriate', label: '부적절한 콘텐츠' },
  { code: 'scam', label: '사기·금전 요구' },
  { code: 'other', label: '기타' },
] as const;

export const USER_REPORT_MAX_IMAGES = 5;
export const USER_REPORT_MAX_DESCRIPTION_LENGTH = 2000;

export function normalizeUserReportReasonCode(code: string): string {
  return code.trim().toLowerCase();
}

export function labelForUserReportReasonCode(code: string): string {
  const key = normalizeUserReportReasonCode(code);
  if (!key) return '기타';
  const found = USER_REPORT_REASONS.find((r) => r.code === key);
  return found?.label ?? '기타';
}

/** @deprecated `labelForUserReportReasonCode` 사용 */
export const labelForReasonCode = labelForUserReportReasonCode;

export function isUserReportReasonCode(code: string): code is UserReportReasonCode {
  return USER_REPORT_REASONS.some((r) => r.code === code);
}
