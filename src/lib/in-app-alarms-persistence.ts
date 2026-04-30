import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { defaultInAppAlarmReadState, type InAppAlarmReadState } from '@/src/lib/in-app-alarms';

const STORAGE_PREFIX = 'ginit:inAppAlarms:v1:';

function keyForUser(phoneUserId: string): string {
  return `${STORAGE_PREFIX}${phoneUserId.trim()}`;
}

type StoredShape = {
  chatReadMessageId?: Record<string, string>;
  meetingAckFingerprint?: Record<string, string>;
  friendRequestDismissedIds?: Record<string, true>;
  friendRequestHeadsUpSentIds?: Record<string, true>;
  friendAcceptedDismissedIds?: Record<string, true>;
};

export async function loadInAppAlarmReadState(phoneUserId: string): Promise<InAppAlarmReadState> {
  const uid = phoneUserId?.trim();
  if (!uid) return defaultInAppAlarmReadState();
  const canon = normalizeParticipantId(uid);
  /** 예전 키(비정규 이메일 등)에 저장된 읽음 상태 호환 */
  const keysToTry = canon && canon !== uid ? [canon, uid] : [canon || uid];
  try {
    for (const k of keysToTry) {
      const raw = await AsyncStorage.getItem(keyForUser(k));
      if (!raw?.trim()) continue;
      const parsed = JSON.parse(raw) as StoredShape;
      ginitNotifyDbg('in-app-alarms-persist', 'load_hit', {
        keySuffix: k.slice(-8),
        chatKeys: Object.keys(parsed.chatReadMessageId ?? {}).length,
        meetingAckKeys: Object.keys(parsed.meetingAckFingerprint ?? {}).length,
      });
      return {
        chatReadMessageId:
          parsed.chatReadMessageId && typeof parsed.chatReadMessageId === 'object'
            ? parsed.chatReadMessageId
            : {},
        meetingAckFingerprint:
          parsed.meetingAckFingerprint && typeof parsed.meetingAckFingerprint === 'object'
            ? parsed.meetingAckFingerprint
            : {},
        friendRequestDismissedIds:
          parsed.friendRequestDismissedIds && typeof parsed.friendRequestDismissedIds === 'object'
            ? parsed.friendRequestDismissedIds
            : {},
        friendRequestHeadsUpSentIds:
          parsed.friendRequestHeadsUpSentIds && typeof parsed.friendRequestHeadsUpSentIds === 'object'
            ? parsed.friendRequestHeadsUpSentIds
            : {},
        friendAcceptedDismissedIds:
          parsed.friendAcceptedDismissedIds && typeof parsed.friendAcceptedDismissedIds === 'object'
            ? parsed.friendAcceptedDismissedIds
            : {},
      };
    }
    ginitNotifyDbg('in-app-alarms-persist', 'load_default', { tried: keysToTry.length });
    return defaultInAppAlarmReadState();
  } catch (e) {
    ginitNotifyDbg('in-app-alarms-persist', 'load_error', { message: e instanceof Error ? e.message : String(e) });
    return defaultInAppAlarmReadState();
  }
}

export async function saveInAppAlarmReadState(phoneUserId: string, state: InAppAlarmReadState): Promise<void> {
  const uid = phoneUserId?.trim();
  if (!uid) return;
  const canon = normalizeParticipantId(uid) || uid;
  try {
    await AsyncStorage.setItem(keyForUser(canon), JSON.stringify(state));
  } catch (e) {
    ginitNotifyDbg('in-app-alarms-persist', 'save_error', { message: e instanceof Error ? e.message : String(e) });
    /* 저장 실패는 알림 기능만 제한 */
  }
}
