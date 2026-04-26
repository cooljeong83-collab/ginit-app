import AsyncStorage from '@react-native-async-storage/async-storage';

/** 채팅방 설정과 동일 키 (`app/meeting-chat/[meetingId]/settings.tsx`) */
export function meetingChatImageQualityStorageKey(meetingId: string): string {
  return `meetingChat.imageQuality.${meetingId.trim()}`;
}

export type MeetingChatImageUploadQuality = 'low' | 'high';

/** 저장값이 `'high'`이면 고화질. 없거나 그 외는 저화질(기본). */
export async function getMeetingChatImageUploadQuality(meetingId: string): Promise<MeetingChatImageUploadQuality> {
  const mid = meetingId.trim();
  if (!mid) return 'low';
  try {
    const v = await AsyncStorage.getItem(meetingChatImageQualityStorageKey(mid));
    if (v === 'high') return 'high';
    return 'low';
  } catch {
    return 'low';
  }
}

export async function setMeetingChatImageUploadQuality(
  meetingId: string,
  quality: MeetingChatImageUploadQuality,
): Promise<void> {
  const mid = meetingId.trim();
  if (!mid) return;
  try {
    await AsyncStorage.setItem(meetingChatImageQualityStorageKey(mid), quality);
  } catch {
    /* noop */
  }
}
