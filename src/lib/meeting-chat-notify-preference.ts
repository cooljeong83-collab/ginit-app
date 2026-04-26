import AsyncStorage from '@react-native-async-storage/async-storage';

/** 채팅방 설정 스위치와 동일 키 (`app/meeting-chat/[meetingId]/settings.tsx`) */
export function meetingChatNotifyStorageKey(meetingId: string): string {
  return `meetingChat.notifyOn.${meetingId.trim()}`;
}

/** 저장값이 `'0'`이면 알림 끔. 없거나 `'1'`이면 켜짐(기본). */
export async function isMeetingChatNotifyEnabled(meetingId: string): Promise<boolean> {
  const mid = meetingId.trim();
  if (!mid) return true;
  try {
    const v = await AsyncStorage.getItem(meetingChatNotifyStorageKey(mid));
    if (v === '0') return false;
    return true;
  } catch {
    return true;
  }
}
