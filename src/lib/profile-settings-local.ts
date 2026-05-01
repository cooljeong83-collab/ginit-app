import AsyncStorage from '@react-native-async-storage/async-storage';

const DND_QUIET_HOURS_KEY = 'ginit_profile_dnd_quiet_hours_v1';

export async function loadProfileDndQuietHoursEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(DND_QUIET_HOURS_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export async function saveProfileDndQuietHoursEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(DND_QUIET_HOURS_KEY, enabled ? '1' : '0');
}
