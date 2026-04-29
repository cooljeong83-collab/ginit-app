import { doc, getDoc } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { sendFcmPushToUsersFireAndForget } from '@/src/lib/fcm-push-api';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { isMeetingChatNotifyEnabled } from '@/src/lib/meeting-chat-notify-preference';
import { isSocialChatNotifyEnabled } from '@/src/lib/social-chat-notify-preference';
import { USER_EXPO_PUSH_TOKENS_COLLECTION } from '@/src/lib/user-expo-push-token';

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

async function fetchExpoPushTokenForUser(userId: string): Promise<string | null> {
  const uid = normalizeParticipantId(userId.trim());
  if (!uid) return null;
  const snap = await getDoc(doc(getFirebaseFirestore(), USER_EXPO_PUSH_TOKENS_COLLECTION, uid));
  const t = snap.data()?.token;
  if (typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))) {
    return t;
  }
  return null;
}

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
  if (!(await ensureNotificationsPresentable())) return;
  await ensureGinitInAppAndroidChannel();
  const c = buildHeadsUpContent(params);
  await Notifications.presentNotificationAsync({
    title: c.title,
    body: c.body,
    subtitle: c.subtitle,
    sound: 'default',
    data: { meetingId: c.meetingId, action: c.action, url: c.url },
    interruptionLevel: 'active',
    priority: 'high',
    ...(Platform.OS === 'android' ? { channelId: GINIT_IN_APP_ANDROID_CHANNEL } : {}),
  });
}

/**
 * 로그인한 사용자 본인의 Expo 푸시 토큰으로 전송(백그라운드·다른 앱 사용 중 헤드업용).
 * @returns 토큰이 있어 전송 시도까지 한 경우 true, 토큰 없음 false
 */
export async function sendInAppAlarmPush(params: SendInAppAlarmPushParams): Promise<boolean> {
  const c = buildHeadsUpContent(params);
  /**
   * IMPORTANT (중복 푸시 방지):
   * - Android: Expo Push도 내부적으로 FCM을 타기 때문에, 여기서 FCM + Expo를 같이 보내면 동일 알림이 중복될 수 있습니다.
   *   따라서 Android는 서버 경유 FCM만 사용합니다.
   * - iOS: FCM 토큰 저장/발송 경로가 없으므로 Expo Push만 사용합니다.
   */
  if (Platform.OS === 'android') {
    // Android(FCM): 수신자가 앱 종료 상태여도 오도록 서버 경유 발송(토큰이 없으면 서버에서 sent=0으로 종료).
    sendFcmPushToUsersFireAndForget({
      toUserIds: [params.userId],
      title: c.title,
      body: c.body,
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

  const token = await fetchExpoPushTokenForUser(params.userId);
  if (!token) return false;
  const msg: ExpoPushMessage = {
    to: token,
    title: c.title,
    body: c.body,
    subtitle: c.subtitle,
    sound: 'default',
    priority: 'high',
    /**
     * Android(Expo push): 수신 기기 채널은 `default`로 고정합니다.
     * 앱이 완전 종료 상태면 커스텀 채널(`ginit_in_app`)이 아직 생성되지 않았을 수 있어 미표시가 날 수 있습니다.
     * `default`는 `PushNotificationBootstrap`에서 앱 부팅 시 항상 생성합니다.
     */
    channelId: 'default',
    /** iOS 전용 필드 — Expo가 Android(FCM) 경로에서는 무시합니다. 발신 기기가 Android여도 수신 iOS에 반영되게 항상 포함합니다. */
    interruptionLevel: 'active',
    data: { meetingId: c.meetingId, action: c.action, url: c.url },
  };
  await sendExpoPushMessages([msg]);
  return true;
}

/**
 * 송신 측에서 호출: `userId` 기기로만 Expo 원격 푸시(호출자 AppState·로컬 배너 무관).
 * 수신자 앱이 백그라운드/화면 꺼짐이어도 토큰이 등록돼 있으면 배너가 갈 수 있습니다.
 */
export function sendInAppAlarmRemotePushToUserFireAndForget(
  userId: string,
  payload: Omit<SendInAppAlarmPushParams, 'userId'>,
): void {
  void (async () => {
    try {
      if (Platform.OS === 'web') return;
      const uid = normalizeParticipantId(userId.trim());
      if (!uid) return;
      await sendInAppAlarmPush({ ...payload, userId: uid });
    } catch (err) {
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
          if (!ok) return;
        }
      }
      if (params.kind === 'social_dm') {
        const rid = params.meetingId.trim();
        if (rid) {
          const ok = await isSocialChatNotifyEnabled(rid);
          if (!ok) return;
        }
      }
      if (AppState.currentState === 'active') {
        if (params.kind === 'chat' || params.kind === 'social_dm') {
          const cur = getCurrentChatRoomId();
          if (cur && cur === params.meetingId.trim()) return;
        }
        await presentLocalHeadsUp(params);
        return;
      }
      const { status: notifPerm } = await Notifications.getPermissionsAsync();
      if (notifPerm !== 'granted') return;
      await sendInAppAlarmPush(params);
    } catch (err) {
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
