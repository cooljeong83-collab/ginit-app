import AsyncStorage from '@react-native-async-storage/async-storage';

const SNOOZE_PREFIX = 'notice_popup_snooze:';

function snoozeKey(noticeId: string, dateKey: string): string {
  return `${SNOOZE_PREFIX}${noticeId}:${dateKey}`;
}

function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function isNoticePopupSnoozedToday(noticeId: string): Promise<boolean> {
  const id = noticeId.trim();
  if (!id) return false;
  try {
    const v = await AsyncStorage.getItem(snoozeKey(id, todayKey()));
    return v === '1';
  } catch {
    return false;
  }
}

export async function snoozeNoticePopupForToday(noticeId: string): Promise<void> {
  const id = noticeId.trim();
  if (!id) return;
  try {
    await AsyncStorage.setItem(snoozeKey(id, todayKey()), '1');
  } catch {
    /* ignore */
  }
}
