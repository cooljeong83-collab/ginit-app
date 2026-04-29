import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/src/lib/supabase';

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

/** 여러 모임의 채팅 알림 ON/OFF를 한 번에 조회합니다. */
export async function getMeetingChatNotifyEnabledMap(
  meetingIds: string[],
): Promise<Record<string, boolean>> {
  const mids = [...new Set(meetingIds.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (mids.length === 0) return {};
  try {
    const pairs = await AsyncStorage.multiGet(mids.map((mid) => meetingChatNotifyStorageKey(mid)));
    const out: Record<string, boolean> = {};
    for (let i = 0; i < mids.length; i += 1) {
      const v = pairs[i]?.[1];
      out[mids[i]!] = v !== '0';
    }
    return out;
  } catch {
    const fallback: Record<string, boolean> = {};
    for (const mid of mids) fallback[mid] = true;
    return fallback;
  }
}

export async function getMeetingChatNotifyEnabledForUser(meetingId: string, appUserId: string): Promise<boolean> {
  const mid = meetingId.trim();
  const uid = appUserId.trim();
  if (!mid || !uid) return true;
  try {
    const { data, error } = await supabase.rpc('get_chat_room_notify_enabled', {
      p_app_user_id: uid,
      p_room_id: mid,
    });
    if (error) throw error;
    const enabled = typeof data === 'boolean' ? data : true;
    await AsyncStorage.setItem(meetingChatNotifyStorageKey(mid), enabled ? '1' : '0');
    return enabled;
  } catch {
    return isMeetingChatNotifyEnabled(mid);
  }
}

export async function setMeetingChatNotifyEnabledForUser(
  meetingId: string,
  appUserId: string,
  enabled: boolean,
): Promise<void> {
  const mid = meetingId.trim();
  const uid = appUserId.trim();
  if (!mid || !uid) return;
  await AsyncStorage.setItem(meetingChatNotifyStorageKey(mid), enabled ? '1' : '0');
  const { error } = await supabase.rpc('set_chat_room_notify_enabled', {
    p_app_user_id: uid,
    p_room_id: mid,
    p_notify_enabled: enabled,
  });
  if (error) throw error;
}
