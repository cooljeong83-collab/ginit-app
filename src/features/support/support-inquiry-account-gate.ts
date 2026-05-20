import type { SupportInquiryCategoryId, SupportInquiryFormValues } from '@/src/features/support/support-inquiry';

export type SupportInquiryAccountGateParams = {
  fromAccountGate?: string;
  reason?: string;
  message?: string;
  appUserId?: string;
};

export function isSupportInquiryFromAccountGate(
  params: SupportInquiryAccountGateParams,
): boolean {
  const v = params.fromAccountGate?.trim();
  return v === '1' || v === 'true';
}

/** 이용 중지·탈퇴 안내 화면에서 문의하기 진입 시 폼 초기값 */
export function supportInquiryPrefillFromAccountGate(
  params: SupportInquiryAccountGateParams,
): Partial<SupportInquiryFormValues> {
  if (!isSupportInquiryFromAccountGate(params)) return {};

  const reason = params.reason?.trim() || 'suspended';
  const gateMessage = params.message?.trim() || '';
  const title =
    reason === 'withdrawn' ? '탈퇴 계정 관련 문의' : '이용 중지 계정 관련 문의';
  const intro =
    reason === 'withdrawn'
      ? '탈퇴한 계정과 관련해 아래 내용을 확인했습니다.'
      : '이용이 중지된 계정과 관련해 아래 내용을 확인했습니다.';

  const bodyLines = [intro];
  if (gateMessage) bodyLines.push('', gateMessage);
  bodyLines.push('', '문의 내용:');

  return {
    categoryId: 'account' as SupportInquiryCategoryId,
    title,
    body: bodyLines.join('\n'),
  };
}
