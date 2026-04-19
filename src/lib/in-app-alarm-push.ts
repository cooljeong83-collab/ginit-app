import { doc, getDoc } from 'firebase/firestore';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
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

export type InAppAlarmPushKind = 'chat' | 'meeting_change';

async function fetchExpoPushTokenForUser(phoneUserId: string): Promise<string | null> {
  const uid = normalizePhoneUserId(phoneUserId.trim()) ?? phoneUserId.trim();
  if (!uid) return null;
  const snap = await getDoc(doc(getFirebaseFirestore(), USER_EXPO_PUSH_TOKENS_COLLECTION, uid));
  const t = snap.data()?.token;
  if (typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))) {
    return t;
  }
  return null;
}

export type SendInAppAlarmPushParams = {
  phoneUserId: string;
  kind: InAppAlarmPushKind;
  meetingId: string;
  meetingTitle: string;
  /** 채팅일 때 본문 미리보기 */
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
  return {
    title: '모임 소식',
    body: `「${mt}」참여 중인 모임 정보가 바뀌었어요.`,
    meetingId: mid,
    action: 'in_app_meeting',
    url: `ginitapp://meeting/${mid}`,
  };
}

async function presentLocalHeadsUp(params: SendInAppAlarmPushParams): Promise<void> {
  if (Platform.OS === 'web') return;
  await ensureGinitInAppAndroidChannel();
  const c = buildHeadsUpContent(params);
  /** Android: `channelId`만 있는 trigger가 즉시 전달 + 고중요도 채널에 연결됩니다. iOS: `null`이 즉시입니다. */
  const trigger =
    Platform.OS === 'android' ? { channelId: GINIT_IN_APP_ANDROID_CHANNEL } : null;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: c.title,
      body: c.body,
      subtitle: c.subtitle,
      sound: 'default',
      data: { meetingId: c.meetingId, action: c.action, url: c.url },
      interruptionLevel: 'active',
      priority: 'high',
    },
    trigger,
  });
}

/**
 * 로그인한 사용자 본인의 Expo 푸시 토큰으로 전송(백그라운드·다른 앱 사용 중 헤드업용).
 */
export async function sendInAppAlarmPush(params: SendInAppAlarmPushParams): Promise<void> {
  const token = await fetchExpoPushTokenForUser(params.phoneUserId);
  if (!token) return;
  const c = buildHeadsUpContent(params);
  const msg: ExpoPushMessage = {
    to: token,
    title: c.title,
    body: c.body,
    subtitle: c.subtitle,
    sound: 'default',
    priority: 'high',
    channelId: GINIT_IN_APP_ANDROID_CHANNEL,
    data: { meetingId: c.meetingId, action: c.action, url: c.url },
  };
  await sendExpoPushMessages([msg]);
}

/**
 * 앱이 포그라운드면 로컬 즉시 알림(배너), 그 외에는 원격 푸시.
 * 채팅 본문은 `body`에 넣어 배너에서 바로 읽히게 합니다.
 */
export function notifyInAppAlarmHeadsUpFireAndForget(params: SendInAppAlarmPushParams): void {
  void (async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureGinitInAppAndroidChannel();
      if (AppState.currentState === 'active') {
        await presentLocalHeadsUp(params);
        return;
      }
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
