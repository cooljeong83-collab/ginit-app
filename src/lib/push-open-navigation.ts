import * as Linking from 'expo-linking';
import type { Router } from 'expo-router';

import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { getMeetingById, type Meeting } from '@/src/lib/meetings';
import { TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION } from '@/src/lib/trust-penalty-notify';

/** 푸시로 채팅만 열리면 `router.back()`할 스택이 없어, 채팅 탭을 한 번 깔고 방을 push 합니다. */
export function navigateToChatRoomWithChatTabUnderneath(
  router: Router,
  roomHref: string,
  opts?: { replace?: boolean; currentPathname?: string },
): void {
  const replace = Boolean(opts?.replace);
  const cur = (opts?.currentPathname ?? '').trim();
  if (cur && cur === roomHref) {
    ginitNotifyDbg('push-open-nav', 'skip_nav_same_path', { roomHref });
    return;
  }
  ginitNotifyDbg('push-open-nav', 'navigate_chat_stack', { roomHref, replace });
  const openRoom = () => {
    router.push(roomHref as never);
  };
  if (replace) {
    router.replace('/(tabs)/chat' as never);
    queueMicrotask(openRoom);
    return;
  }
  router.push('/(tabs)/chat' as never);
  queueMicrotask(openRoom);
}

export function navigateFromPushData(
  router: Router,
  data: Record<string, unknown> | undefined,
  opts?: { replace?: boolean; currentPathname?: string },
): void {
  if (!data || typeof data !== 'object') {
    ginitNotifyDbg('push-open-nav', 'navigate_skip_no_data', {});
    return;
  }
  const replace = Boolean(opts?.replace);
  const navTo = (path: string) => {
    const cur = (opts?.currentPathname ?? '').trim();
    if (cur && cur === path) {
      ginitNotifyDbg('push-open-nav', 'skip_nav_same_path', { path });
      return;
    }
    ginitNotifyDbg('push-open-nav', 'navigate', { path, replace });
    if (replace) router.replace(path as never);
    else router.push(path as never);
  };
  const actionAny =
    typeof (data as { action?: unknown }).action === 'string' ? String((data as { action: string }).action).trim() : '';
  if (actionAny === TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION) {
    navTo('/(tabs)/profile');
    return;
  }
  if (
    actionAny === 'friend_request' ||
    actionAny === 'in_app_friend_request' ||
    actionAny === 'in_app_friend_accepted'
  ) {
    navTo('/(tabs)/friends');
    return;
  }
  if (actionAny === 'follow_request') {
    navTo('/social/connections');
    return;
  }
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (meetingId && action === 'new_meeting_in_feed_region') {
    navTo(`/meeting/${meetingId}`);
    return;
  }
  if (meetingId && action === 'in_app_chat') {
    navigateToChatRoomWithChatTabUnderneath(router, `/meeting-chat/${meetingId}`, opts);
    return;
  }
  if (meetingId && action === 'in_app_social_dm') {
    navigateToChatRoomWithChatTabUnderneath(router, `/social-chat/${encodeURIComponent(meetingId)}`, opts);
    return;
  }
  if (meetingId && action === 'in_app_meeting') {
    navTo(`/meeting/${meetingId}`);
    return;
  }
  if (!meetingId) {
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    if (url) void Linking.openURL(url);
    return;
  }
  if (action === 'deleted') {
    router.replace('/(tabs)' as never);
    return;
  }
  navTo(`/meeting/${meetingId}`);
}

export async function markAlarmReadFromPushData(
  data: Record<string, unknown> | undefined,
  markMeetingAlarmsReadByPushTap: (m: Meeting) => void,
  markFriendRequestAlarmDismissed: (friendshipId: string) => void,
  markFriendAcceptedAlarmDismissed: (friendshipId: string) => void,
): Promise<void> {
  if (!data || typeof data !== 'object') return;
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (action === 'in_app_friend_request' && meetingId) {
    ginitNotifyDbg('push-open-nav', 'mark_read_friend_request', { meetingId });
    markFriendRequestAlarmDismissed(meetingId);
    return;
  }
  if (action === 'in_app_friend_accepted' && meetingId) {
    ginitNotifyDbg('push-open-nav', 'mark_read_friend_accepted', { meetingId });
    markFriendAcceptedAlarmDismissed(meetingId);
    return;
  }
  if (!meetingId) return;
  const shouldAckMeeting =
    action === 'in_app_meeting' ||
    action === 'participant_joined' ||
    action === 'participant_left' ||
    action === 'host_transferred';
  if (!shouldAckMeeting) return;
  const m = await getMeetingById(meetingId);
  if (!m) {
    ginitNotifyDbg('push-open-nav', 'mark_meeting_ack_skip_no_meeting', { meetingId, action });
    return;
  }
  ginitNotifyDbg('push-open-nav', 'mark_meeting_ack', { meetingId, action });
  markMeetingAlarmsReadByPushTap(m);
}
