import type { Router } from 'expo-router';

import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

function stripRouteQueryHash(path: string): string {
  const t = path.trim();
  if (!t) return '';
  const noHash = t.split('#')[0] ?? '';
  return (noHash.split('?')[0] ?? '').trim();
}

export function parseGinitAppAdminReportDestination(
  url: string,
): { type: 'admin_report_list' } | { type: 'admin_report_detail'; reportId: string } | null {
  const u = url.trim();
  if (!u.toLowerCase().startsWith('ginitapp://')) return null;
  const rest = (u.slice('ginitapp://'.length).split(/[?#]/)[0] ?? '').trim();
  const segs = rest.split('/').filter(Boolean);
  const head = (segs[0] ?? '').toLowerCase();
  if (head !== 'admin') return null;
  if ((segs[1] ?? '').toLowerCase() !== 'reports') {
    return { type: 'admin_report_list' };
  }
  if (segs[2]) {
    try {
      return { type: 'admin_report_detail', reportId: decodeURIComponent(segs[2]) };
    } catch {
      return { type: 'admin_report_detail', reportId: segs[2] };
    }
  }
  return { type: 'admin_report_list' };
}

function adminPathFromPushData(data: Record<string, unknown>): string | null {
  const pathRaw = typeof data.path === 'string' ? data.path.trim() : '';
  if (pathRaw.startsWith('/admin/reports')) {
    return pathRaw;
  }
  const reportId =
    typeof data.report_id === 'string'
      ? data.report_id.trim()
      : typeof (data as { reportId?: unknown }).reportId === 'string'
        ? String((data as { reportId: string }).reportId).trim()
        : '';
  if (reportId) return `/admin/reports/${encodeURIComponent(reportId)}`;
  return null;
}

export function isAdminPushOpenData(data: Record<string, unknown> | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (action === 'admin_open' || action === 'admin_message') return true;
  const url = typeof data.url === 'string' ? data.url.trim() : '';
  if (url.toLowerCase().startsWith('ginitapp://admin/')) return true;
  const path = typeof data.path === 'string' ? data.path.trim() : '';
  if (path.startsWith('/admin')) return true;
  if (typeof data.report_id === 'string' && data.report_id.trim()) return true;
  return false;
}

export function adminPushOpenNavigationSignal(data: Record<string, unknown> | undefined): boolean {
  return isAdminPushOpenData(data);
}

export function tryNavigateAdminFromPushData(
  router: Router,
  data: Record<string, unknown> | undefined,
  opts?: { replace?: boolean; currentPathname?: string },
): boolean {
  if (!isAdminPushOpenData(data) || !data) return false;

  const replace = Boolean(opts?.replace);
  const navTo = (path: string) => {
    const cur = stripRouteQueryHash(opts?.currentPathname ?? '');
    const target = stripRouteQueryHash(path);
    if (cur && target && cur === target) {
      ginitNotifyDbg('push-open-admin', 'skip_nav_same_path', { path });
      return;
    }
    ginitNotifyDbg('push-open-admin', 'navigate', { path, replace });
    if (replace) router.replace(path as never);
    else router.push(path as never);
  };

  const urlRaw = typeof data.url === 'string' ? data.url.trim() : '';
  const fromUrl = urlRaw ? parseGinitAppAdminReportDestination(urlRaw) : null;
  if (fromUrl?.type === 'admin_report_detail') {
    navTo(`/admin/reports/${encodeURIComponent(fromUrl.reportId)}`);
    return true;
  }
  if (fromUrl?.type === 'admin_report_list') {
    navTo('/admin/reports');
    return true;
  }

  const adminPath = adminPathFromPushData(data);
  if (adminPath) {
    navTo(adminPath);
    return true;
  }

  if (
    typeof data.action === 'string' &&
    (data.action === 'admin_open' || data.action === 'admin_message')
  ) {
    navTo('/admin/reports');
    return true;
  }

  return false;
}
