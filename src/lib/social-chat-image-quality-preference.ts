import AsyncStorage from '@react-native-async-storage/async-storage';

/** 1:1 채팅방 설정 스위치 키 (`app/social-chat/[roomId]/settings.tsx`) */
export function socialChatImageQualityStorageKey(roomId: string): string {
  return `socialChat.imageQuality.${roomId.trim()}`;
}

export type SocialChatImageUploadQuality = 'low' | 'high';

/** 저장값이 `'high'`이면 고화질. 없거나 그 외는 저화질(기본). */
export async function getSocialChatImageUploadQuality(roomId: string): Promise<SocialChatImageUploadQuality> {
  const rid = roomId.trim();
  if (!rid) return 'low';
  try {
    const v = await AsyncStorage.getItem(socialChatImageQualityStorageKey(rid));
    if (v === 'high') return 'high';
    return 'low';
  } catch {
    return 'low';
  }
}

export async function setSocialChatImageUploadQuality(roomId: string, quality: SocialChatImageUploadQuality): Promise<void> {
  const rid = roomId.trim();
  if (!rid) return;
  try {
    await AsyncStorage.setItem(socialChatImageQualityStorageKey(rid), quality);
  } catch {
    /* noop */
  }
}

