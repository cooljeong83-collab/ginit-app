import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { NotificationDoc } from '@/src/lib/notifications';
import {
  fetchNotificationsForUser,
  NOTIFICATIONS_TABLE,
  subscribeNotificationsForUser,
} from '@/src/lib/notifications';
import { supabase } from '@/src/lib/supabase';

export const MEETING_FRIEND_INVITE_NOTIFICATION_TYPE = 'meeting_friend_invite';

export type MeetingFriendInviteNotificationPayload = {
  meetingId: string;
  meetingTitle: string;
  inviterAppUserId: string;
  inviterNickname: string;
  url?: string;
};

export function parseMeetingFriendInvitePayload(
  payload: Record<string, unknown> | null | undefined,
): MeetingFriendInviteNotificationPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const meetingId = typeof payload.meetingId === 'string' ? payload.meetingId.trim() : '';
  if (!meetingId) return null;
  const meetingTitle =
    typeof payload.meetingTitle === 'string' && payload.meetingTitle.trim()
      ? payload.meetingTitle.trim()
      : '모임';
  const inviterAppUserId =
    typeof payload.inviterAppUserId === 'string' ? payload.inviterAppUserId.trim() : '';
  const inviterNickname =
    typeof payload.inviterNickname === 'string' && payload.inviterNickname.trim()
      ? payload.inviterNickname.trim()
      : '친구';
  const url = typeof payload.url === 'string' ? payload.url.trim() : undefined;
  return { meetingId, meetingTitle, inviterAppUserId, inviterNickname, url };
}

function notificationCreatedMs(doc: NotificationDoc): number {
  const raw = doc.createdAt;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

export function isUnreadMeetingFriendInviteNotification(doc: NotificationDoc): boolean {
  if (doc.type !== MEETING_FRIEND_INVITE_NOTIFICATION_TYPE) return false;
  if (doc.readAt != null && doc.readAt !== '') return false;
  return parseMeetingFriendInvitePayload(doc.payload) != null;
}

export function filterUnreadMeetingFriendInviteNotifications(docs: NotificationDoc[]): NotificationDoc[] {
  return docs.filter(isUnreadMeetingFriendInviteNotification);
}

export function meetingFriendInviteAlarmSubtitle(payload: MeetingFriendInviteNotificationPayload): string {
  const who = payload.inviterNickname.trim() || '친구';
  const title = payload.meetingTitle.trim() || '모임';
  return `${who}님이 「${title}」에 초대했어요. 탭하면 모임을 볼 수 있어요.`;
}

export function meetingFriendInviteAlarmSortMs(doc: NotificationDoc): number {
  return notificationCreatedMs(doc);
}

export async function fetchUnreadMeetingFriendInviteNotifications(
  appUserId: string,
): Promise<NotificationDoc[]> {
  const uid = normalizeParticipantId(appUserId.trim()) || appUserId.trim();
  if (!uid) return [];
  const items = await fetchNotificationsForUser(uid, 80);
  return filterUnreadMeetingFriendInviteNotifications(items);
}

/** 새소식용 — `notifications` 테이블만 구독·필터합니다. */
export function subscribeMeetingFriendInviteNotifications(
  appUserId: string,
  onData: (items: NotificationDoc[]) => void,
  onError?: (message: string) => void,
): () => void {
  const uid = appUserId.trim();
  if (!uid) {
    onData([]);
    return () => {};
  }
  return subscribeNotificationsForUser(
    uid,
    (items) => onData(filterUnreadMeetingFriendInviteNotifications(items)),
    onError,
    80,
  );
}

export async function markMeetingFriendInviteNotificationRead(
  notificationId: string,
  appUserId: string,
): Promise<void> {
  const id = notificationId.trim();
  const uid = normalizeParticipantId(appUserId) ?? appUserId.trim();
  if (!id || !uid) return;
  const { error: rpcError } = await supabase.rpc('mark_app_notification_read', {
    p_me: uid,
    p_notification_id: id,
    p_type: MEETING_FRIEND_INVITE_NOTIFICATION_TYPE,
  });
  if (!rpcError) return;
  const readAt = new Date().toISOString();
  const { error } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .update({ read_at: readAt })
    .eq('id', id)
    .eq('user_id', uid)
    .eq('type', MEETING_FRIEND_INVITE_NOTIFICATION_TYPE);
  if (error) throw new Error(error.message);
}

export async function markMeetingFriendInviteNotificationsReadForMeeting(
  meetingId: string,
  appUserId: string,
): Promise<void> {
  const mid = meetingId.trim();
  const uid = normalizeParticipantId(appUserId) ?? appUserId.trim();
  if (!mid || !uid) return;
  const readAt = new Date().toISOString();
  const { data: rpcData, error: rpcListError } = await supabase.rpc('list_app_notifications', {
    p_me: uid,
    p_limit: 50,
  });
  let rows: { id?: unknown; payload?: unknown; type?: unknown; read_at?: unknown }[] = [];
  if (!rpcListError) {
    rows = (Array.isArray(rpcData) ? rpcData : []) as typeof rows;
  } else {
    const { data, error } = await supabase
      .from(NOTIFICATIONS_TABLE)
      .select('id,payload,type,read_at')
      .eq('user_id', uid)
      .eq('type', MEETING_FRIEND_INVITE_NOTIFICATION_TYPE)
      .is('read_at', null)
      .limit(50);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as typeof rows;
  }
  const ids = rows
    .filter((row) => row.type === MEETING_FRIEND_INVITE_NOTIFICATION_TYPE && (row.read_at == null || row.read_at === ''))
    .filter((row) => {
      const p = parseMeetingFriendInvitePayload(
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : null,
      );
      return p?.meetingId === mid;
    })
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
  if (ids.length === 0) return;
  for (const nid of ids) {
    const { error: rpcErr } = await supabase.rpc('mark_app_notification_read', {
      p_me: uid,
      p_notification_id: nid,
      p_type: MEETING_FRIEND_INVITE_NOTIFICATION_TYPE,
    });
    if (rpcErr) {
      const { error: updErr } = await supabase
        .from(NOTIFICATIONS_TABLE)
        .update({ read_at: readAt })
        .eq('id', nid)
        .eq('user_id', uid);
      if (updErr) throw new Error(updErr.message);
    }
  }
}
