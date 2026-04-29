import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';

/** 1:1 채팅방 설정 스위치 키 (`app/social-chat/[roomId]/settings.tsx`) */
export function socialChatNotifyStorageKey(roomId: string): string {
  return `socialChat.notifyOn.${roomId.trim()}`;
}

/** 저장값이 `'0'`이면 알림 끔. 없거나 `'1'`이면 켜짐(기본). */
export async function isSocialChatNotifyEnabled(roomId: string): Promise<boolean> {
  const rid = roomId.trim();
  if (!rid) return true;
  try {
    const v = await AsyncStorage.getItem(socialChatNotifyStorageKey(rid));
    if (v === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export async function setSocialChatNotifyEnabled(roomId: string, enabled: boolean): Promise<void> {
  const rid = roomId.trim();
  if (!rid) return;
  try {
    await AsyncStorage.setItem(socialChatNotifyStorageKey(rid), enabled ? '1' : '0');
  } catch {
    /* noop */
  }
}

/**
 * 모임 채팅과 동일 RPC를 사용해 서버 기준 알림 ON/OFF를 조회합니다.
 * 실패 시 로컬 캐시(`isSocialChatNotifyEnabled`)로 폴백합니다.
 */
export async function getSocialChatNotifyEnabledForUser(roomId: string, appUserId: string): Promise<boolean> {
  const rid = roomId.trim();
  const uid = appUserId.trim();
  if (!rid || !uid) return true;
  try {
    const { data, error } = await supabase.rpc('get_chat_room_notify_enabled', {
      p_app_user_id: uid,
      p_room_id: rid,
    });
    if (error) throw error;
    const enabled = typeof data === 'boolean' ? data : true;
    await AsyncStorage.setItem(socialChatNotifyStorageKey(rid), enabled ? '1' : '0');
    return enabled;
  } catch {
    return isSocialChatNotifyEnabled(rid);
  }
}

/**
 * 모임 채팅과 동일 RPC를 사용해 서버에 알림 ON/OFF를 저장합니다.
 * 로컬 캐시도 함께 갱신합니다.
 */
export async function setSocialChatNotifyEnabledForUser(roomId: string, appUserId: string, enabled: boolean): Promise<void> {
  const rid = roomId.trim();
  const uid = appUserId.trim();
  if (!rid || !uid) return;
  await AsyncStorage.setItem(socialChatNotifyStorageKey(rid), enabled ? '1' : '0');
  const { error } = await supabase.rpc('set_chat_room_notify_enabled', {
    p_app_user_id: uid,
    p_room_id: rid,
    p_notify_enabled: enabled,
  });
  if (error) throw error;
}

