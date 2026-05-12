import * as Linking from 'expo-linking';
import type { Router } from 'expo-router';

import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { MEETING_REMOVED_BY_HOST_PUSH_ACTION } from '@/src/lib/meeting-host-push-notify';
import { getMeetingById, type Meeting } from '@/src/lib/meetings';
import { TRUST_PENALTY_PROFILE_NOTIFICATION_ACTION } from '@/src/lib/trust-penalty-notify';

/** `adb logcat` / Metro 에서 `[GinitNotify:push-open-nav]` 필터 */
function summarizePushNavData(data: Record<string, unknown>): Record<string, unknown> {
  const action = typeof data.action === 'string' ? data.action : '';
  const mid = typeof data.meetingId === 'string' ? data.meetingId : '';
  const url = typeof data.url === 'string' ? data.url : '';
  return {
    keys: Object.keys(data)
      .slice(0, 28)
      .join(','),
    action: action || '(empty)',
    meetingIdLen: mid.length,
    meetingIdTail: mid.length > 10 ? mid.slice(-10) : mid || '(empty)',
    urlHead: url ? url.slice(0, 80) : '(empty)',
  };
}

/** `usePathname()` 과 room href 비교 시 쿼리·해시 차이로 동일 화면을 못 잡는 경우 방지 */
function stripRouteQueryHash(path: string): string {
  const t = path.trim();
  if (!t) return '';
  const noHash = t.split('#')[0] ?? '';
  return (noHash.split('?')[0] ?? '').trim();
}

/**
 * 푸시 `data.url` 이 `ginitapp://social-chat/...` 또는 `ginitapp://meeting-chat/...` 일 때 파싱.
 * (FCM/Notifee 경로에서 `action` 키가 비거나 달라져도 채팅으로 보내기 위함)
 */
export function parseGinitAppChatDestination(
  url: string,
):
  | { type: 'social_dm'; roomId: string }
  | { type: 'meeting_chat'; meetingId: string }
  | { type: 'meeting_detail'; meetingId: string }
  | null {
  const u = url.trim();
  if (!u.toLowerCase().startsWith('ginitapp://')) return null;
  const rest = (u.slice('ginitapp://'.length).split(/[?#]/)[0] ?? '').trim();
  const segs = rest.split('/').filter(Boolean);
  const head = (segs[0] ?? '').toLowerCase();
  if (head === 'social-chat' && segs[1]) {
    try {
      return { type: 'social_dm', roomId: decodeURIComponent(segs[1]) };
    } catch {
      return { type: 'social_dm', roomId: segs[1] };
    }
  }
  if (head === 'meeting-chat' && segs[1]) {
    try {
      return { type: 'meeting_chat', meetingId: decodeURIComponent(segs[1]) };
    } catch {
      return { type: 'meeting_chat', meetingId: segs[1] };
    }
  }
  if (head === 'meeting' && segs[1]) {
    try {
      return { type: 'meeting_detail', meetingId: decodeURIComponent(segs[1]) };
    } catch {
      return { type: 'meeting_detail', meetingId: segs[1] };
    }
  }
  return null;
}

function tryNavigateChatFromGinitPushUrl(
  router: Router,
  urlRaw: string,
  opts?: { replace?: boolean; currentPathname?: string },
): boolean {
  const d = parseGinitAppChatDestination(urlRaw);
  if (!d) return false;
  if (d.type === 'social_dm') {
    ginitNotifyDbg('push-open-nav', 'navigate_ginit_url_social_dm', { roomIdSuffix: d.roomId.slice(-8) });
    navigateToChatRoomWithChatTabUnderneath(router, `/social-chat/${encodeURIComponent(d.roomId)}`, opts);
    return true;
  }
  if (d.type === 'meeting_chat') {
    ginitNotifyDbg('push-open-nav', 'navigate_ginit_url_meeting_chat', { meetingId: d.meetingId });
    navigateToChatRoomWithChatTabUnderneath(router, `/meeting-chat/${d.meetingId}`, opts);
    return true;
  }
  ginitNotifyDbg('push-open-nav', 'navigate_ginit_url_meeting_detail', { meetingId: d.meetingId });
  const path = `/meeting/${d.meetingId}`;
  if (opts?.replace) router.replace(path as never);
  else router.push(path as never);
  return true;
}

/** 푸시로 채팅만 열리면 `router.back()`할 스택이 없어, 채팅 탭을 한 번 깔고 방을 push 합니다. */
export function navigateToChatRoomWithChatTabUnderneath(
  router: Router,
  roomHref: string,
  opts?: { replace?: boolean; currentPathname?: string },
): void {
  const replace = Boolean(opts?.replace);
  const cur = stripRouteQueryHash(opts?.currentPathname ?? '');
  const target = stripRouteQueryHash(roomHref);
  if (cur && target && cur === target) {
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

/**
 * Expo `Notifications` 응답의 `content.data`에 Notifee 래퍼 키만 오는 경우가 있어,
 * pending 적재·즉시 네비 전에 호출해 FCM과 동일한 “열 수 있는” payload 인지 판별합니다.
 */
export function hasPushOpenNavigationSignal(data: Record<string, unknown> | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const url = typeof data.url === 'string' ? data.url.trim() : '';
  if (action || meetingId) return true;
  if (url) return true;
  return false;
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
  ginitNotifyDbg('push-open-nav', 'navigate_begin', {
    ...summarizePushNavData(data),
    currentPath: stripRouteQueryHash(opts?.currentPathname ?? '') || '(empty)',
    replace: Boolean(opts?.replace),
  });
  const replace = Boolean(opts?.replace);
  const navTo = (path: string) => {
    const cur = stripRouteQueryHash(opts?.currentPathname ?? '');
    const target = stripRouteQueryHash(path);
    if (cur && target && cur === target) {
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
    ginitNotifyDbg('push-open-nav', 'branch_trust_penalty_profile', {});
    navTo('/(tabs)/profile');
    return;
  }
  if (
    actionAny === 'friend_request' ||
    actionAny === 'in_app_friend_request' ||
    actionAny === 'in_app_friend_accepted'
  ) {
    ginitNotifyDbg('push-open-nav', 'branch_friends', { actionAny });
    navTo('/(tabs)/friends');
    return;
  }
  if (actionAny === 'follow_request') {
    ginitNotifyDbg('push-open-nav', 'branch_social_connections', {});
    navTo('/social/connections');
    return;
  }
  let meetingId = typeof data.meetingId === 'string' ? data.meetingId.trim() : '';
  const meetingIdSnake = typeof (data as { meeting_id?: unknown }).meeting_id === 'string'
    ? String((data as { meeting_id: string }).meeting_id).trim()
    : '';
  if (!meetingId && meetingIdSnake) meetingId = meetingIdSnake;
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const typeRaw = typeof (data as { type?: unknown }).type === 'string' ? String((data as { type: string }).type).trim() : '';
  const urlRaw = typeof data.url === 'string' ? data.url.trim() : '';
  if (meetingId && (action === 'settlement_share' || typeRaw === 'SETTLEMENT')) {
    ginitNotifyDbg('push-open-nav', 'branch_settlement', { meetingIdLen: meetingId.length });
    navTo(`/settlement/${meetingId}`);
    return;
  }
  if (meetingId && action === 'new_meeting_in_feed_region') {
    ginitNotifyDbg('push-open-nav', 'branch_new_meeting_feed', { meetingIdLen: meetingId.length });
    navTo(`/meeting/${meetingId}`);
    return;
  }
  if (meetingId && action === 'in_app_chat') {
    ginitNotifyDbg('push-open-nav', 'branch_meeting_chat', { meetingIdLen: meetingId.length });
    navigateToChatRoomWithChatTabUnderneath(router, `/meeting-chat/${meetingId}`, opts);
    return;
  }
  if (meetingId && action === 'in_app_social_dm') {
    ginitNotifyDbg('push-open-nav', 'branch_social_dm', { meetingIdLen: meetingId.length });
    navigateToChatRoomWithChatTabUnderneath(router, `/social-chat/${encodeURIComponent(meetingId)}`, opts);
    return;
  }
  if (meetingId && action === 'in_app_meeting') {
    ginitNotifyDbg('push-open-nav', 'branch_meeting_detail', { meetingIdLen: meetingId.length });
    navTo(`/meeting/${meetingId}`);
    return;
  }
  if (!meetingId) {
    ginitNotifyDbg('push-open-nav', 'branch_no_meetingId', { hasUrl: Boolean(urlRaw) });
    if (tryNavigateChatFromGinitPushUrl(router, urlRaw, opts)) return;
    if (urlRaw) void Linking.openURL(urlRaw);
    return;
  }
  if (action === 'deleted' || action === MEETING_REMOVED_BY_HOST_PUSH_ACTION) {
    ginitNotifyDbg('push-open-nav', 'branch_meeting_deleted_or_removed', { action });
    router.replace('/(tabs)' as never);
    return;
  }
  if (tryNavigateChatFromGinitPushUrl(router, urlRaw, opts)) {
    ginitNotifyDbg('push-open-nav', 'branch_url_fallback_before_default_meeting', {});
    return;
  }
  ginitNotifyDbg('push-open-nav', 'branch_default_meeting_screen', {
    meetingIdLen: meetingId.length,
    action: action || '(empty)',
  });
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
    action === 'participant_join_requested' ||
    action === 'join_request_approved' ||
    action === 'join_request_rejected' ||
    action === 'host_transferred' ||
    action === MEETING_REMOVED_BY_HOST_PUSH_ACTION;
  if (!shouldAckMeeting) return;
  const m = await getMeetingById(meetingId);
  if (!m) {
    ginitNotifyDbg('push-open-nav', 'mark_meeting_ack_skip_no_meeting', { meetingId, action });
    return;
  }
  ginitNotifyDbg('push-open-nav', 'mark_meeting_ack', { meetingId, action });
  markMeetingAlarmsReadByPushTap(m);
}
