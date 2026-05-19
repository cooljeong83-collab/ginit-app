import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { NotificationDoc } from '@/src/lib/notifications';
import {
  fetchNotificationsForUser,
  NOTIFICATIONS_TABLE,
  subscribeNotificationsForUser,
} from '@/src/lib/notifications';
import { supabase } from '@/src/lib/supabase';

export const MEETING_PLACE_REVIEW_NOTIFICATION_TYPE = 'meeting_place_review';

export type MeetingPlaceReviewNotificationPayload = {
  meetingId: string;
  meetingTitle: string;
};

export function parseMeetingPlaceReviewPayload(
  payload: Record<string, unknown> | null | undefined,
): MeetingPlaceReviewNotificationPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const meetingId = typeof payload.meetingId === 'string' ? payload.meetingId.trim() : '';
  if (!meetingId) return null;
  const meetingTitle =
    typeof payload.meetingTitle === 'string' && payload.meetingTitle.trim()
      ? payload.meetingTitle.trim()
      : '모임';
  return { meetingId, meetingTitle };
}

function notificationCreatedMs(doc: NotificationDoc): number {
  const raw = doc.createdAt;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

export function isUnreadMeetingPlaceReviewNotification(doc: NotificationDoc): boolean {
  if (doc.type !== MEETING_PLACE_REVIEW_NOTIFICATION_TYPE) return false;
  if (doc.readAt != null && doc.readAt !== '') return false;
  return parseMeetingPlaceReviewPayload(doc.payload) != null;
}

export function filterUnreadMeetingPlaceReviewNotifications(docs: NotificationDoc[]): NotificationDoc[] {
  return docs.filter(isUnreadMeetingPlaceReviewNotification);
}

export function meetingPlaceReviewAlarmSubtitle(payload: MeetingPlaceReviewNotificationPayload): string {
  const title = payload.meetingTitle.trim() || '모임';
  return `「${title}」장소 후기를 남기고 결과를 확인해 보세요.`;
}

export function meetingPlaceReviewAlarmSortMs(doc: NotificationDoc): number {
  return notificationCreatedMs(doc);
}

export async function fetchUnreadMeetingPlaceReviewNotifications(
  appUserId: string,
): Promise<NotificationDoc[]> {
  const uid = normalizeParticipantId(appUserId.trim()) || appUserId.trim();
  if (!uid) return [];
  const items = await fetchNotificationsForUser(uid, 80);
  return filterUnreadMeetingPlaceReviewNotifications(items);
}

export function subscribeMeetingPlaceReviewNotifications(
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
    (items) => onData(filterUnreadMeetingPlaceReviewNotifications(items)),
    onError,
    80,
  );
}

export async function markMeetingPlaceReviewNotificationRead(
  notificationId: string,
  appUserId: string,
): Promise<void> {
  const id = notificationId.trim();
  const uid = normalizeParticipantId(appUserId) ?? appUserId.trim();
  if (!id || !uid) return;
  const { error: rpcError } = await supabase.rpc('mark_app_notification_read', {
    p_me: uid,
    p_notification_id: id,
    p_type: MEETING_PLACE_REVIEW_NOTIFICATION_TYPE,
  });
  if (!rpcError) return;
  const readAt = new Date().toISOString();
  const { error } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .update({ read_at: readAt })
    .eq('id', id)
    .eq('user_id', uid)
    .eq('type', MEETING_PLACE_REVIEW_NOTIFICATION_TYPE);
  if (error) throw new Error(error.message);
}

export async function insertMeetingPlaceReviewNotifications(params: {
  meetingId: string;
  meetingTitle: string;
  recipientAppUserIds: string[];
}): Promise<{ ok: boolean; message?: string }> {
  const ids = [...new Set(params.recipientAppUserIds.map((x) => x.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: true };
  const { error } = await supabase.rpc('insert_meeting_place_review_notifications', {
    p_meeting_id: params.meetingId.trim(),
    p_meeting_title: params.meetingTitle.trim() || '모임',
    p_recipient_app_user_ids: ids,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
