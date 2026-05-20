import { messageForAccountGateReason } from '@/src/features/account-suspension/account-suspended-messages';
import { fetchAccountSessionGate } from '@/src/features/account-suspension/account-session-gate-api';

type AccountGateRouter = {
  replace: (href: string | { pathname: string; params?: Record<string, string> }) => void;
};

export type EnforceAccountGateDeps = {
  router: AccountGateRouter;
  signOutSession: () => Promise<void>;
};

/**
 * 세션 게이트 실패(이용 중지·탈퇴) 시 로그아웃 후 `/account-suspended`로 이동.
 * @returns true — 탭·온보딩 등 앱 진입 가능
 */
export async function enforceAccountGate(
  appUserId: string,
  deps: EnforceAccountGateDeps,
): Promise<boolean> {
  const gate = await fetchAccountSessionGate(appUserId);
  if (gate.ok) return true;

  const reason = gate.reason ?? 'suspended';
  if (reason !== 'suspended' && reason !== 'withdrawn') {
    return true;
  }

  try {
    await deps.signOutSession();
  } catch {
    /* 게이트 차단은 세션 정리 실패와 무관하게 안내 화면으로 보냄 */
  }

  const message = messageForAccountGateReason(reason, gate.message);
  deps.router.replace({
    pathname: '/account-suspended',
    params: { reason, message, appUserId: appUserId.trim() },
  });
  return false;
}
