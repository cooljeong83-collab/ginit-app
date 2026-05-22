import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'promo_verify:';

export async function isPromotionMatchVerifyDismissed(meetingId: string): Promise<boolean> {
  const mid = meetingId.trim();
  if (!mid) return false;
  try {
    const v = await AsyncStorage.getItem(`${KEY_PREFIX}${mid}`);
    return v === '1';
  } catch {
    return false;
  }
}

export async function dismissPromotionMatchVerify(meetingId: string): Promise<void> {
  const mid = meetingId.trim();
  if (!mid) return;
  try {
    await AsyncStorage.setItem(`${KEY_PREFIX}${mid}`, '1');
  } catch {
    /* ignore */
  }
}
