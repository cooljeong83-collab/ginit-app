import type { Router } from 'expo-router';

/**
 * 신고 화면으로 이동합니다. 프로필·친구설정 등 기존 화면은 이 함수만 호출합니다.
 */
export function openUserReportScreen(
  router: Router,
  reportedUserId: string,
  displayName?: string,
): void {
  const id = reportedUserId.trim();
  if (!id) return;
  const nick = displayName?.trim();
  const q = nick ? `?displayName=${encodeURIComponent(nick)}` : '';
  router.push(`/report/${encodeURIComponent(id)}${q}` as never);
}
