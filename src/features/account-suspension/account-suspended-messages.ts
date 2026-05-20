import { toUserFacingErrorMessage } from '@/src/lib/user-facing-error-message';

export const ACCOUNT_SUSPENDED_DEFAULT_MESSAGE =
  '운영 정책에 따라 이용이 중지된 계정입니다. 문의가 필요하면 고객센터로 연락해 주세요.';

export const ACCOUNT_WITHDRAWN_DEFAULT_MESSAGE =
  '탈퇴한 계정입니다. 다시 가입하려면 고객센터에 문의해 주세요.';

export function messageForAccountGateReason(
  reason: string | undefined,
  serverMessage?: string | null,
): string {
  const server = serverMessage?.trim();
  if (server) return toUserFacingErrorMessage(server);
  if (reason === 'withdrawn') return ACCOUNT_WITHDRAWN_DEFAULT_MESSAGE;
  return ACCOUNT_SUSPENDED_DEFAULT_MESSAGE;
}
