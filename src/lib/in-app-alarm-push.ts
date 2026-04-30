import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { dispatchRemotePushToRecipients } from '@/src/lib/remote-push-hub';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import { isSocialChatNotifyEnabled } from '@/src/lib/social-chat-notify-preference';

/** Android 헤드업 배너용 — `HIGH` 이상이어야 다른 앱 사용 중에도 상단 배너가 뜨는 경우가 많습니다. */
export const GINIT_IN_APP_ANDROID_CHANNEL = 'ginit_in_app';

export async function ensureGinitInAppAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(GINIT_IN_APP_ANDROID_CHANNEL, {
    name: '새 소식',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 220],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
}

/** 로컬·시스템 배너 표시 전에 호출 — 미요청/거절 시 한 번 더 요청합니다. */
export async function ensureNotificationsPresentable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
      allowDisplayInCarPlay: true,
    },
  });
  return status === 'granted';
}

export type InAppAlarmPushKind = 'chat' | 'meeting_change' | 'friend_request' | 'friend_accepted' | 'social_dm';

export type SendInAppAlarmPushParams = {
  userId: string;
  kind: InAppAlarmPushKind;
  meetingId: string;
  meetingTitle: string;
  /** 채팅 본문 미리보기 또는 모임 변경 상세 문구 */
  preview?: string;
};

function buildHeadsUpContent(params: SendInAppAlarmPushParams): {
  title: string;
  body: string;
  subtitle?: string;
  meetingId: string;
  action: string;
  url: string;
} {
  const mt = params.meetingTitle.trim() || '모임';
  const mid = params.meetingId.trim();
  if (params.kind === 'friend_request') {
    const name = mt || '친구';
    const body = (params.preview ?? '').trim() || `${name}님이 친구 요청을 보냈어요.`;
    return {
      title: '친구 요청',
      subtitle: name,
      body,
      meetingId: mid,
      action: 'in_app_friend_request',
      url: 'ginitapp://friends',
    };
  }
  if (params.kind === 'friend_accepted') {
    const name = mt || '친구';
    const body = (params.preview ?? '').trim() || `${name}님이 친구 요청을 수락했어요.`;
    return {
      title: '친구 연결',
      subtitle: name,
      body,
      meetingId: mid,
      action: 'in_app_friend_accepted',
      url: 'ginitapp://friends',
    };
  }
  if (params.kind === 'social_dm') {
    const name = mt || '친구';
    const preview = (params.preview ?? '').trim().slice(0, 500) || '새 글이 도착했어요.';
    return {
      title: name,
      subtitle: '친구 메시지',
      body: preview,
      meetingId: mid,
      action: 'in_app_social_dm',
      url: `ginitapp://social-chat/${encodeURIComponent(mid)}`,
    };
  }
  if (params.kind === 'chat') {
    const preview = (params.preview ?? '').trim().slice(0, 500) || '새 글이 도착했어요.';
    return {
      title: `「${mt}」`,
      subtitle: '새 메시지',
      body: preview,
      meetingId: mid,
      action: 'in_app_chat',
      url: `ginitapp://meeting-chat/${mid}`,
    };
  }
  const override = (params.preview ?? '').trim();
  return {
    title: `「${mt}」`,
    subtitle: '모임 소식',
    body: override || `참여 중인 모임 정보가 바뀌었어요.`,
    meetingId: mid,
    action: 'in_app_meeting',
    url: `ginitapp://meeting/${mid}`,
  };
}

async function presentLocalHeadsUp(params: SendInAppAlarmPushParams): Promise<void> {
  if (Platform.OS === 'web') return;
  const permOk = await ensureNotificationsPresentable();
  if (!permOk) {
    ginitNotifyDbg('in-app-alarm-push', 'local_heads_up_skip_perm', { kind: params.kind, meetingId: params.meetingId });
    return;
  }
  await ensureGinitInAppAndroidChannel();
  const c = buildHeadsUpContent(params);
  ginitNotifyDbg('in-app-alarm-push', 'local_heads_up_present', {
    kind: params.kind,
    meetingId: c.meetingId,
    action: c.action,
  });
  /**
   * SDK 54 `expo-notifications`는 `presentNotificationAsync`를 더 이상 export하지 않습니다.
   * 즉시 표시는 `scheduleNotificationAsync` + `trigger: null`(iOS) / `{ channelId }`(Android 즉시·채널)로 처리합니다.
   */
  await Notifications.scheduleNotificationAsync({
    content: {
      title: c.title,
      body: c.body,
      subtitle: c.subtitle,
      sound: 'default',
      data: { meetingId: c.meetingId, action: c.action, url: c.url },
      interruptionLevel: 'active',
      ...(Platform.OS === 'android'
        ? { priority: Notifications.AndroidNotificationPriority.HIGH }
        : {}),
    },
    trigger:
      Platform.OS === 'android'
        ? { channelId: GINIT_IN_APP_ANDROID_CHANNEL }
        : null,
  });
}

/**
 * 수신자에게 원격 시스템 알림(FCM 우선 → 미전달 시 Expo). 로직은 `remote-push-hub` 단일 경로.
 * @returns FCM 또는 Expo 중 하나라도 시도되면 true(허브 내부에서 전부 스킵이면 false에 가깝게 처리하기 어려워 true 고정)
 */
export async function sendInAppAlarmPush(params: SendInAppAlarmPushParams): Promise<boolean> {
  const c = buildHeadsUpContent(params);
  ginitNotifyDbg('in-app-alarm-push', 'remote_push_dispatch', {
    kind: params.kind,
    meetingId: c.meetingId,
    action: c.action,
    recipientUserIdSuffix: String(params.userId).slice(-6),
  });
  await dispatchRemotePushToRecipients({
    toUserIds: [params.userId],
    title: c.title,
    body: c.body,
    expoSubtitle: c.subtitle,
    expoInterruptionLevel: 'active',
    data: {
      meetingId: c.meetingId,
      action: c.action,
      url: c.url,
      title: c.title,
      body: c.body,
    },
  });
  return true;
}

/**
 * 송신 측에서 호출: 수신 `userId`로 원격 알림(`remote-push-hub`: FCM → 필요 시 Expo).
 */
export function sendInAppAlarmRemotePushToUserFireAndForget(
  userId: string,
  payload: Omit<SendInAppAlarmPushParams, 'userId'>,
): void {
  void (async () => {
    try {
      if (Platform.OS === 'web') return;
      const uid = normalizeParticipantId(userId.trim());
      if (!uid) {
        ginitNotifyDbg('in-app-alarm-push', 'remote_fire_forget_skip_uid', { kind: payload.kind });
        return;
      }
      await sendInAppAlarmPush({ ...payload, userId: uid });
    } catch (err) {
      ginitNotifyDbg('in-app-alarm-push', 'remote_fire_forget_error', {
        kind: payload.kind,
        message: err instanceof Error ? err.message : String(err),
      });
      if (__DEV__) {
        console.warn('[in-app-alarm-push] remote-only', err);
      }
    }
  })();
}

/** 앱 활성 상태에서는 로컬 헤드업, 그 외에는 원격 푸시를 전송합니다. */
export function notifyInAppAlarmHeadsUpFireAndForget(params: SendInAppAlarmPushParams): void {
  void (async () => {
    try {
      if (Platform.OS === 'web') return;
      // 채팅방 설정에서 알림을 꺼둔 경우: 포그라운드 배너/백그라운드 푸시 모두 차단
      if (params.kind === 'chat') {
        const mid = params.meetingId.trim();
        if (mid) {
          const ok = await isMeetingChatNotifyEnabled(mid);
          if (!ok) {
            ginitNotifyDbg('in-app-alarm-push', 'heads_up_skip_meeting_notify_off', { meetingId: mid });
            return;
          }
        }
      }
      if (params.kind === 'social_dm') {
        const rid = params.meetingId.trim();
        if (rid) {
          const ok = await isSocialChatNotifyEnabled(rid);
          if (!ok) {
            ginitNotifyDbg('in-app-alarm-push', 'heads_up_skip_social_notify_off', { roomId: rid });
            return;
          }
        }
      }
      if (AppState.currentState === 'active') {
        if (params.kind === 'chat' || params.kind === 'social_dm') {
          const cur = getCurrentChatRoomId();
          if (cur && cur === params.meetingId.trim()) {
            ginitNotifyDbg('in-app-alarm-push', 'heads_up_skip_same_open_room', {
              kind: params.kind,
              roomId: cur,
            });
            return;
          }
        }
        await presentLocalHeadsUp(params);
        return;
      }
      const { status: notifPerm } = await Notifications.getPermissionsAsync();
      if (notifPerm !== 'granted') {
        ginitNotifyDbg('in-app-alarm-push', 'heads_up_remote_skip_perm_bg', {
          kind: params.kind,
          meetingId: params.meetingId.trim(),
          expoNotifPerm: notifPerm,
        });
        return;
      }
      ginitNotifyDbg('in-app-alarm-push', 'heads_up_remote_from_bg', {
        kind: params.kind,
        meetingId: params.meetingId.trim(),
        appState: AppState.currentState,
        expoNotifPerm: notifPerm,
      });
      await sendInAppAlarmPush(params);
    } catch (err) {
      ginitNotifyDbg('in-app-alarm-push', 'heads_up_error', {
        kind: params.kind,
        message: err instanceof Error ? err.message : String(err),
      });
      if (__DEV__) {
        console.warn('[in-app-alarm-push]', err);
      }
    }
  })();
}

/** @deprecated 내부에서 `notifyInAppAlarmHeadsUpFireAndForget` 사용을 권장합니다. */
export function sendInAppAlarmPushFireAndForget(params: SendInAppAlarmPushParams): void {
  notifyInAppAlarmHeadsUpFireAndForget(params);
}
