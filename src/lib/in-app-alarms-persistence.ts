import AsyncStorage from '@react-native-async-storage/async-storage';

import { defaultInAppAlarmReadState, type InAppAlarmReadState } from '@/src/lib/in-app-alarms';

const STORAGE_PREFIX = 'ginit:inAppAlarms:v1:';

function keyForUser(phoneUserId: string): string {
  return `${STORAGE_PREFIX}${phoneUserId.trim()}`;
}

type StoredShape = {
  chatReadMessageId?: Record<string, string>;
  meetingAckFingerprint?: Record<string, string>;
};

export async function loadInAppAlarmReadState(phoneUserId: string): Promise<InAppAlarmReadState> {
  const uid = phoneUserId?.trim();
  if (!uid) return defaultInAppAlarmReadState();
  try {
    const raw = await AsyncStorage.getItem(keyForUser(uid));
    if (!raw?.trim()) return defaultInAppAlarmReadState();
    const parsed = JSON.parse(raw) as StoredShape;
    return {
      chatReadMessageId:
        parsed.chatReadMessageId && typeof parsed.chatReadMessageId === 'object'
          ? parsed.chatReadMessageId
          : {},
      meetingAckFingerprint:
        parsed.meetingAckFingerprint && typeof parsed.meetingAckFingerprint === 'object'
          ? parsed.meetingAckFingerprint
          : {},
    };
  } catch {
    return defaultInAppAlarmReadState();
  }
}

export async function saveInAppAlarmReadState(phoneUserId: string, state: InAppAlarmReadState): Promise<void> {
  const uid = phoneUserId?.trim();
  if (!uid) return;
  try {
    await AsyncStorage.setItem(keyForUser(uid), JSON.stringify(state));
  } catch {
    /* 저장 실패는 알림 기능만 제한 */
  }
}
