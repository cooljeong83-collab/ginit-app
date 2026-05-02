/** 웹에서는 푸시/로컬 알림 미사용 — `expo-notifications`를 로드하지 않습니다(SSR 안전). */

export const GINIT_IN_APP_ANDROID_CHANNEL = 'ginit_in_app';

export async function getGinitInAppAndroidChannelId(): Promise<string> {
  return 'ginit_in_app_w_default';
}

export type InAppAlarmPushKind = 'chat' | 'meeting_change' | 'friend_request' | 'friend_accepted' | 'social_dm';

export type SendInAppAlarmPushParams = {
  userId: string;
  kind: InAppAlarmPushKind;
  meetingId: string;
  meetingTitle: string;
  preview?: string;
};

export async function ensureGinitInAppAndroidChannel(): Promise<void> {}

export async function ensureNotificationsPresentable(): Promise<boolean> {
  return false;
}

export async function sendInAppAlarmPush(_params: SendInAppAlarmPushParams): Promise<boolean> {
  return false;
}

export function notifyInAppAlarmHeadsUpFireAndForget(_params: SendInAppAlarmPushParams): void {}

export function sendInAppAlarmRemotePushToUserFireAndForget(
  _userId: string,
  _payload: Omit<SendInAppAlarmPushParams, 'userId'>,
): void {}

/** @deprecated 내부에서 `notifyInAppAlarmHeadsUpFireAndForget` 사용을 권장합니다. */
export function sendInAppAlarmPushFireAndForget(params: SendInAppAlarmPushParams): void {
  notifyInAppAlarmHeadsUpFireAndForget(params);
}
