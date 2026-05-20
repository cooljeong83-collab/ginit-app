import { supabase } from '@/src/lib/supabase';
import { toUserFacingErrorMessage } from '@/src/lib/user-facing-error-message';

export type SupportAnnouncementListItem = {
  id: string;
  title: string;
  publishedAt: string;
  imageUrl: string | null;
};

export type SupportAnnouncementDetail = {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  publishedAt: string;
};

export const SUPPORT_ANNOUNCEMENTS_LOGIN_REQUIRED = '로그인이 필요해요. 공지사항을 보려면 로그인해 주세요.';

function mapAnnouncementsRpcError(message: string, code?: string): string {
  const m = message.trim().toLowerCase();
  const c = (code ?? '').trim().toLowerCase();
  if (m.includes('authentication_required') || m.includes('jwt') || c === 'pgrst301' || c === '401') {
    return SUPPORT_ANNOUNCEMENTS_LOGIN_REQUIRED;
  }
  if (m.includes('not_found')) return '공지를 찾을 수 없어요.';
  return toUserFacingErrorMessage(message || '공지를 불러오지 못했어요.');
}

function parseListItem(raw: unknown): SupportAnnouncementListItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const publishedAt = typeof o.published_at === 'string' ? o.published_at : '';
  if (!id || !title || !publishedAt) return null;
  const imageUrl =
    typeof o.image_url === 'string' && o.image_url.trim() ? o.image_url.trim() : null;
  return { id, title, publishedAt, imageUrl };
}

export async function listPublishedAnnouncements(params: {
  limit?: number;
  cursor?: string | null;
}): Promise<{ items: SupportAnnouncementListItem[]; nextCursor: string | null }> {
  const { data, error } = await supabase.rpc('list_published_announcements', {
    p_limit: params.limit ?? 20,
    p_cursor: params.cursor ?? null,
  });
  if (error) {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
    throw new Error(mapAnnouncementsRpcError(error.message, code));
  }
  const root = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const itemsRaw = Array.isArray(root.items) ? root.items : [];
  const items = itemsRaw
    .map(parseListItem)
    .filter((x): x is SupportAnnouncementListItem => x != null);
  const nextCursor =
    typeof root.next_cursor === 'string' && root.next_cursor.trim() ? root.next_cursor.trim() : null;
  return { items, nextCursor };
}

export async function getPublishedAnnouncement(id: string): Promise<SupportAnnouncementDetail> {
  const trimmed = id.trim();
  if (!trimmed) throw new Error('공지를 찾을 수 없어요.');
  const { data, error } = await supabase.rpc('get_published_announcement', { p_id: trimmed });
  if (error) {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;
    throw new Error(mapAnnouncementsRpcError(error.message, code));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('공지를 찾을 수 없어요.');
  }
  const o = data as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const body = typeof o.body === 'string' ? o.body : '';
  const publishedAt = typeof o.published_at === 'string' ? o.published_at : '';
  if (!title || !publishedAt) throw new Error('공지를 찾을 수 없어요.');
  return {
    id: typeof o.id === 'string' ? o.id : trimmed,
    title,
    body,
    imageUrl: typeof o.image_url === 'string' && o.image_url.trim() ? o.image_url.trim() : null,
    publishedAt,
  };
}

/** 게시 후 7일 이내 NEW 배지 */
export function isSupportAnnouncementNew(publishedAtIso: string, nowMs = Date.now()): boolean {
  const t = Date.parse(publishedAtIso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= 7 * 24 * 60 * 60 * 1000;
}

export function formatSupportAnnouncementDate(publishedAtIso: string): string {
  const d = new Date(publishedAtIso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}
