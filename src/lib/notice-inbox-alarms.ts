import { DeviceEventEmitter } from 'react-native';

import { getAppQueryClient } from '@/src/context/QueryClientPersistProvider';
import {
  listMyNoticeInbox,
  markNoticeInboxRead,
  markNoticeInboxReadByNoticeId,
  NOTICES_QUERY_KEY_ROOT,
  type NoticeInboxListItem,
} from '@/src/features/notices/notices-api';
import { activeNoticesQueryKey } from '@/src/hooks/use-active-notices-query';
import { noticeInboxQueryKey } from '@/src/hooks/use-notice-inbox-infinite-query';
import { noticeInboxUnreadCountQueryKey } from '@/src/hooks/use-notice-inbox-unread-count-query';

/** FCM 공지 수신·읽음 처리 후 `InAppAlarmsContext`가 수신함을 다시 불러옵니다. */
export const NOTICE_INBOX_ALARMS_REFRESH_EVENT = 'ginit:notice-inbox-alarms-refresh';

export function requestNoticeInboxAlarmsRefresh(): void {
  DeviceEventEmitter.emit(NOTICE_INBOX_ALARMS_REFRESH_EVENT);
}

export async function fetchUnreadNoticeInboxAlarms(limit = 40): Promise<NoticeInboxListItem[]> {
  const { items } = await listMyNoticeInbox({ limit, cursor: null });
  return items.filter((it) => !it.isRead);
}

export function noticeInboxAlarmTitle(item: NoticeInboxListItem): string {
  const t = item.title.trim();
  if (t) return t;
  if (item.isImageOnly) return '이미지 공지';
  return '운영 공지';
}

export function noticeInboxAlarmSubtitle(item: NoticeInboxListItem): string {
  const c = item.content.trim();
  if (c) return c.length > 120 ? `${c.slice(0, 120)}…` : c;
  if (item.isImageOnly) return '탭하면 공지 이미지를 볼 수 있어요.';
  return '탭하면 공지를 볼 수 있어요.';
}

export function noticeInboxAlarmSortMs(item: NoticeInboxListItem): number {
  const ms = Date.parse(item.inboxCreatedAt);
  return Number.isFinite(ms) ? ms : Date.now();
}

export function invalidateNoticeInboxQueries(): void {
  const qc = getAppQueryClient();
  if (!qc) return;
  void qc.invalidateQueries({ queryKey: NOTICES_QUERY_KEY_ROOT });
  void qc.invalidateQueries({ queryKey: noticeInboxUnreadCountQueryKey() });
  void qc.invalidateQueries({ queryKey: noticeInboxQueryKey() });
  void qc.invalidateQueries({ queryKey: activeNoticesQueryKey('home_banner') });
  void qc.invalidateQueries({ queryKey: activeNoticesQueryKey('popup') });
}

export async function markNoticeInboxAlarmRead(item: NoticeInboxListItem): Promise<void> {
  const inboxId = item.inboxId.trim();
  if (inboxId) {
    await markNoticeInboxRead(inboxId);
  } else {
    await markNoticeInboxReadByNoticeId(item.noticeId);
  }
  invalidateNoticeInboxQueries();
  requestNoticeInboxAlarmsRefresh();
}
