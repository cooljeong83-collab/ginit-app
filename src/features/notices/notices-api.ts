import { supabase } from '@/src/lib/supabase';
import { toUserFacingErrorMessage } from '@/src/lib/user-facing-error-message';

export type NoticeChannel = 'home_banner' | 'popup';

export type ActiveNoticeItem = {
  id: string;
  title: string;
  content: string;
  linkUrl: string | null;
  imageUrl: string | null;
  isHomeBanner: boolean;
  isPopup: boolean;
  startAt: string | null;
  endAt: string | null;
  targetScope: string;
  createdAt: string;
  inboxId: string | null;
  isRead: boolean;
};

export type NoticeInboxListItem = {
  inboxId: string;
  noticeId: string;
  isRead: boolean;
  inboxCreatedAt: string;
  title: string;
  content: string;
  linkUrl: string | null;
  imageUrl: string | null;
  isHomeBanner: boolean;
  isPopup: boolean;
  isPushAlarm: boolean;
  startAt: string | null;
  endAt: string | null;
  targetScope: string;
  noticeCreatedAt: string;
};

export type NoticeDetail = {
  id: string;
  title: string;
  content: string;
  linkUrl: string | null;
  imageUrl: string | null;
  isHomeBanner: boolean;
  isPopup: boolean;
  isPushAlarm: boolean;
  startAt: string | null;
  endAt: string | null;
  targetScope: string;
  createdAt: string;
  inboxId: string | null;
  isRead: boolean;
};

export const NOTICES_LOGIN_REQUIRED = '로그인이 필요해요. 공지를 보려면 로그인해 주세요.';

function mapNoticesRpcError(message: string, code?: string): string {
  const m = message.trim().toLowerCase();
  const c = (code ?? '').trim().toLowerCase();
  if (m.includes('authentication_required') || m.includes('jwt') || c === 'pgrst301' || c === '401') {
    return NOTICES_LOGIN_REQUIRED;
  }
  if (m.includes('not_found')) return '공지를 찾을 수 없어요.';
  return toUserFacingErrorMessage(message || '공지를 불러오지 못했어요.');
}

function rpcError(error: { message: string; code?: string }): Error {
  const code = typeof error.code === 'string' ? error.code : undefined;
  return new Error(mapNoticesRpcError(error.message, code));
}

function parseActiveNotice(raw: unknown): ActiveNoticeItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const content = typeof o.content === 'string' ? o.content : '';
  const createdAt = typeof o.created_at === 'string' ? o.created_at : '';
  if (!id || !title) return null;
  return {
    id,
    title,
    content,
    linkUrl: typeof o.link_url === 'string' && o.link_url.trim() ? o.link_url.trim() : null,
    imageUrl: typeof o.image_url === 'string' && o.image_url.trim() ? o.image_url.trim() : null,
    isHomeBanner: o.is_home_banner === true,
    isPopup: o.is_popup === true,
    startAt: typeof o.start_at === 'string' ? o.start_at : null,
    endAt: typeof o.end_at === 'string' ? o.end_at : null,
    targetScope: typeof o.target_scope === 'string' ? o.target_scope : 'all',
    createdAt,
    inboxId: typeof o.inbox_id === 'string' ? o.inbox_id.trim() : null,
    isRead: o.is_read === true,
  };
}

function parseInboxItem(raw: unknown): NoticeInboxListItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const inboxId = typeof o.inbox_id === 'string' ? o.inbox_id.trim() : '';
  const noticeId = typeof o.notice_id === 'string' ? o.notice_id.trim() : '';
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const inboxCreatedAt = typeof o.inbox_created_at === 'string' ? o.inbox_created_at : '';
  if (!inboxId || !noticeId || !title || !inboxCreatedAt) return null;
  return {
    inboxId,
    noticeId,
    isRead: o.is_read === true,
    inboxCreatedAt,
    title,
    content: typeof o.content === 'string' ? o.content : '',
    linkUrl: typeof o.link_url === 'string' && o.link_url.trim() ? o.link_url.trim() : null,
    imageUrl: typeof o.image_url === 'string' && o.image_url.trim() ? o.image_url.trim() : null,
    isHomeBanner: o.is_home_banner === true,
    isPopup: o.is_popup === true,
    isPushAlarm: o.is_push_alarm === true,
    startAt: typeof o.start_at === 'string' ? o.start_at : null,
    endAt: typeof o.end_at === 'string' ? o.end_at : null,
    targetScope: typeof o.target_scope === 'string' ? o.target_scope : 'all',
    noticeCreatedAt: typeof o.notice_created_at === 'string' ? o.notice_created_at : '',
  };
}

function parseDetail(raw: unknown, fallbackId: string): NoticeDetail | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : fallbackId;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const content = typeof o.content === 'string' ? o.content : '';
  const createdAt = typeof o.created_at === 'string' ? o.created_at : '';
  if (!id || !title) return null;
  return {
    id,
    title,
    content,
    linkUrl: typeof o.link_url === 'string' && o.link_url.trim() ? o.link_url.trim() : null,
    imageUrl: typeof o.image_url === 'string' && o.image_url.trim() ? o.image_url.trim() : null,
    isHomeBanner: o.is_home_banner === true,
    isPopup: o.is_popup === true,
    isPushAlarm: o.is_push_alarm === true,
    startAt: typeof o.start_at === 'string' ? o.start_at : null,
    endAt: typeof o.end_at === 'string' ? o.end_at : null,
    targetScope: typeof o.target_scope === 'string' ? o.target_scope : 'all',
    createdAt,
    inboxId: typeof o.inbox_id === 'string' ? o.inbox_id.trim() : null,
    isRead: o.is_read === true,
  };
}

export async function listActiveNoticesForMe(channel: NoticeChannel): Promise<ActiveNoticeItem[]> {
  const { data, error } = await supabase.rpc('list_active_notices_for_me', { p_channel: channel });
  if (error) throw rpcError(error);
  const rows = Array.isArray(data) ? data : [];
  return rows.map(parseActiveNotice).filter((x): x is ActiveNoticeItem => x != null);
}

export async function listMyNoticeInbox(params: {
  limit?: number;
  cursor?: string | null;
}): Promise<{ items: NoticeInboxListItem[]; nextCursor: string | null }> {
  const { data, error } = await supabase.rpc('list_my_notice_inbox', {
    p_limit: params.limit ?? 25,
    p_cursor: params.cursor ?? null,
  });
  if (error) throw rpcError(error);
  const root = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const itemsRaw = Array.isArray(root.items) ? root.items : [];
  const items = itemsRaw.map(parseInboxItem).filter((x): x is NoticeInboxListItem => x != null);
  const nextCursor =
    typeof root.next_cursor === 'string' && root.next_cursor.trim() ? root.next_cursor.trim() : null;
  return { items, nextCursor };
}

export async function countMyNoticeInboxUnread(): Promise<number> {
  const { data, error } = await supabase.rpc('count_my_notice_inbox_unread');
  if (error) throw rpcError(error);
  const n = typeof data === 'number' ? data : Number(data);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function markNoticeInboxRead(inboxId: string): Promise<void> {
  const trimmed = inboxId.trim();
  if (!trimmed) throw new Error('공지를 찾을 수 없어요.');
  const { error } = await supabase.rpc('mark_notice_inbox_read', { p_inbox_id: trimmed });
  if (error) throw rpcError(error);
}

export async function markNoticeInboxReadByNoticeId(noticeId: string): Promise<void> {
  const trimmed = noticeId.trim();
  if (!trimmed) throw new Error('공지를 찾을 수 없어요.');
  const { error } = await supabase.rpc('mark_notice_inbox_read_by_notice_id', { p_notice_id: trimmed });
  if (error) throw rpcError(error);
}

export async function getNoticeDetailForMe(noticeId: string): Promise<NoticeDetail> {
  const trimmed = noticeId.trim();
  if (!trimmed) throw new Error('공지를 찾을 수 없어요.');
  const { data, error } = await supabase.rpc('get_notice_detail_for_me', { p_notice_id: trimmed });
  if (error) throw rpcError(error);
  const detail = parseDetail(data, trimmed);
  if (!detail) throw new Error('공지를 찾을 수 없어요.');
  return detail;
}

export function formatNoticeDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function isNoticeNew(inboxCreatedAtIso: string, nowMs = Date.now()): boolean {
  const t = Date.parse(inboxCreatedAtIso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= 7 * 24 * 60 * 60 * 1000;
}

/** TanStack Query 키 루트 — 채팅 Realtime 토픽 `user_notifications:{id}` 와 무관 */
export const NOTICES_QUERY_KEY_ROOT = ['notices'] as const;
