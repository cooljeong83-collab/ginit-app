import { labelForUserReportReasonCode } from '@/src/features/user-report/user-report-reasons';
import { supabase } from '@/src/lib/supabase';
import {
  mapAdminResolveUserReportError,
  toUserFacingErrorMessage,
} from '@/src/lib/user-facing-error-message';

export type AdminReportApprovalAction = 'penalty' | 'suspend';

/** `admin_list_user_reports` — pending·reviewing(미처리)만 */
export const ADMIN_USER_REPORT_LIST_STATUS_OPEN = 'open';

export type AdminUserReportListItem = {
  id: string;
  reported_app_user_id: string;
  reported_nickname: string;
  reason_code: string;
  status: string;
  priority: string;
  approval_action?: string | null;
  created_at: string;
};

export type AdminUserReportRow = {
  id: string;
  reporter_app_user_id: string;
  reported_app_user_id: string;
  reason_code: string;
  description: string | null;
  evidence: { image_urls?: string[] } | null;
  status: string;
  priority: string;
  approval_action?: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export async function listAdminUserReports(params?: {
  status?: string | null;
  limit?: number;
  cursor?: string | null;
}): Promise<{ items: AdminUserReportListItem[]; nextCursor: string | null }> {
  const { data, error } = await supabase.rpc('admin_list_user_reports', {
    p_status: params?.status ?? null,
    p_limit: params?.limit ?? 30,
    p_cursor: params?.cursor ?? null,
  });
  if (error) throw new Error(toUserFacingErrorMessage(error.message, error.code));
  const row = (data ?? {}) as { items?: unknown; next_cursor?: unknown };
  const items = Array.isArray(row.items) ? (row.items as AdminUserReportListItem[]) : [];
  const nextCursor = typeof row.next_cursor === 'string' ? row.next_cursor : null;
  return { items, nextCursor };
}

export async function getAdminUserReport(reportId: string): Promise<AdminUserReportRow> {
  const { data, error } = await supabase.rpc('admin_get_user_report', {
    p_report_id: reportId,
  });
  if (error) throw new Error(toUserFacingErrorMessage(error.message, error.code));
  if (!data || typeof data !== 'object') {
    throw new Error(toUserFacingErrorMessage('not_found'));
  }
  const r = data as Record<string, unknown>;
  const evidenceRaw = r.evidence;
  let evidence: AdminUserReportRow['evidence'] = null;
  if (evidenceRaw && typeof evidenceRaw === 'object') {
    const ev = evidenceRaw as { image_urls?: unknown };
    const urls = Array.isArray(ev.image_urls)
      ? ev.image_urls.filter((u): u is string => typeof u === 'string')
      : [];
    evidence = urls.length > 0 ? { image_urls: urls } : null;
  }
  return {
    id: String(r.id ?? ''),
    reporter_app_user_id: String(r.reporter_app_user_id ?? ''),
    reported_app_user_id: String(r.reported_app_user_id ?? ''),
    reason_code: String(r.reason_code ?? ''),
    description: typeof r.description === 'string' ? r.description : null,
    evidence,
    status: String(r.status ?? ''),
    priority: String(r.priority ?? ''),
    approval_action:
      typeof r.approval_action === 'string' && r.approval_action.trim()
        ? r.approval_action.trim()
        : null,
    resolved_at: typeof r.resolved_at === 'string' ? r.resolved_at : null,
    resolution_note: typeof r.resolution_note === 'string' ? r.resolution_note : null,
    created_at: String(r.created_at ?? ''),
  };
}

export async function resolveAdminUserReport(params: {
  reportId: string;
  status: 'reviewing' | 'approved' | 'dismissed';
  approvalAction?: AdminReportApprovalAction | null;
  resolutionNote?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_user_report', {
    p_report_id: params.reportId,
    p_status: params.status,
    p_resolution_note: params.resolutionNote?.trim() || null,
    p_approval_action:
      params.status === 'approved' ? params.approvalAction ?? null : null,
  });
  if (error) {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
    throw new Error(mapAdminResolveUserReportError(error.message, code));
  }
}

export function formatAdminReportReasonLabel(code: string): string {
  return labelForUserReportReasonCode(code);
}

export function formatAdminReportApprovalActionLabel(
  action: string | null | undefined,
): string | null {
  switch (action) {
    case 'penalty':
      return '패널티';
    case 'suspend':
      return '이용 중지';
    default:
      return null;
  }
}
