import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PUBLIC = 'ginit_meetings_feed_last_sync_at_iso';
const KEY_MY = 'ginit_meetings_my_feed_last_sync_at_iso';

export async function getPublicMeetingsFeedLastSyncIso(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PUBLIC);
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

export async function setPublicMeetingsFeedLastSyncIso(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PUBLIC, iso);
  } catch {
    /* ignore */
  }
}

export async function getMyMeetingsFeedLastSyncIso(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_MY);
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

export async function setMyMeetingsFeedLastSyncIso(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_MY, iso);
  } catch {
    /* ignore */
  }
}

export async function clearPublicMeetingsFeedLastSyncIso(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PUBLIC);
  } catch {
    /* ignore */
  }
}

export async function clearMyMeetingsFeedLastSyncIso(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_MY);
  } catch {
    /* ignore */
  }
}
