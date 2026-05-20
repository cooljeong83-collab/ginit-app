import type { Router } from 'expo-router';

/** 운영자 신고 목록 — `/admin/*` 스택(레이아웃 게이트)으로만 진입 */
export function openAdminReportsListScreen(router: Router): void {
  router.push('/admin/reports' as never);
}
