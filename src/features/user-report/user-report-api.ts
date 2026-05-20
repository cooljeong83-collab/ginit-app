import type { UserReportReasonCode } from '@/src/features/user-report/user-report-reasons';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { supabase } from '@/src/lib/supabase';
import { ensureUserProfile } from '@/src/lib/user-profile';
import { toUserFacingErrorMessage } from '@/src/lib/user-facing-error-message';

export const USER_REPORT_LOGIN_REQUIRED_MESSAGE = '로그인이 필요해요.';

function mapSubmitUserReportError(message: string, code?: string): string {
  const m = message.trim().toLowerCase();
  const c = (code ?? '').trim().toLowerCase();
  if (m.includes('duplicate_report')) return '이미 접수된 신고가 검토 중이에요.';
  if (m.includes('cannot_report_self')) return '본인은 신고할 수 없어요.';
  if (m.includes('cannot_report_system_user')) return '이 사용자는 신고할 수 없어요.';
  if (m.includes('invalid_reason_code')) return '신고 사유를 선택해 주세요.';
  if (m.includes('too_many_images')) return '첨부 이미지는 최대 5장까지예요.';
  if (m.includes('invalid_image_url')) return '첨부 이미지 URL이 올바르지 않아요.';
  if (
    m.includes('not_authenticated') ||
    m.includes('profile_not_found') ||
    m.includes('jwt') ||
    m.includes('invalid claim') ||
    c === 'pgrst301' ||
    c === '401'
  ) {
    return USER_REPORT_LOGIN_REQUIRED_MESSAGE;
  }
  if (m.includes('reported_user_required')) return '신고 대상을 찾을 수 없어요.';
  return toUserFacingErrorMessage(message || '신고 접수에 실패했어요.');
}

/** 신고 RPC 전: 로컬 PK + Supabase JWT + `profiles.auth_user_id` 연결을 맞춥니다. */
export async function prepareUserReportReporterId(
  reporterAppUserId: string | null | undefined,
): Promise<string> {
  const id = normalizeParticipantId((reporterAppUserId ?? '').trim());
  if (!id) throw new Error(USER_REPORT_LOGIN_REQUIRED_MESSAGE);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token?.trim()) {
    throw new Error(USER_REPORT_LOGIN_REQUIRED_MESSAGE);
  }

  await ensureUserProfile(id);
  return id;
}

export async function submitUserReport(params: {
  reporterAppUserId: string;
  reportedAppUserId: string;
  reasonCode: UserReportReasonCode;
  description?: string | null;
  imageUrls?: string[];
}): Promise<string> {
  const reporter = await prepareUserReportReporterId(params.reporterAppUserId);

  const reported = params.reportedAppUserId.trim();
  if (!reported) throw new Error('신고 대상을 찾을 수 없어요.');

  const desc = params.description?.trim() ?? '';
  const urls = (params.imageUrls ?? []).map((u) => u.trim()).filter(Boolean);
  const evidence = urls.length > 0 ? { image_urls: urls } : null;

  const { data, error } = await supabase.rpc('submit_user_report', {
    p_reported_app_user_id: reported,
    p_reason_code: params.reasonCode,
    p_description: desc || null,
    p_evidence: evidence,
    p_reporter_app_user_id: reporter,
  });

  if (error) {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
    throw new Error(mapSubmitUserReportError(error.message, code));
  }
  const id = typeof data === 'string' ? data.trim() : String(data ?? '').trim();
  if (!id) throw new Error('신고 접수에 실패했어요.');
  return id;
}
