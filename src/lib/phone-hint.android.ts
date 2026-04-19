import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Google Hint / Credential Manager 없이, SIM에 등록된 번호를 조용히 읽습니다.
 * - Android 13+(API 33): `READ_PHONE_NUMBERS` + `READ_PHONE_STATE`
 * - 그 이하: `READ_PHONE_STATE`
 * - 값은 `react-native-device-info` 의 `getPhoneNumber()` (Telephony line1) 사용
 */
const LOG = '[Ginit:SimPhone]';

const READ_PHONE_STATE = 'android.permission.READ_PHONE_STATE' as const;
const READ_PHONE_NUMBERS = 'android.permission.READ_PHONE_NUMBERS' as const;

async function ensureSimPhonePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const chain: readonly string[] =
    api >= 33 ? [READ_PHONE_NUMBERS, READ_PHONE_STATE] : [READ_PHONE_STATE];

  try {
    for (const perm of chain) {
      const result = await PermissionsAndroid.request(perm as never);
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        console.warn(LOG, 'permission denied', perm, result);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn(LOG, 'permission request failed', e);
    return false;
  }
}

export async function fetchAndroidPhoneHint(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  const granted = await ensureSimPhonePermissions();
  if (!granted) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DeviceInfo = require('react-native-device-info') as typeof import('react-native-device-info');
    const raw = await DeviceInfo.getPhoneNumber();
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed || /^unknown$/i.test(trimmed)) return null;
    return trimmed;
  } catch (e) {
    console.warn(LOG, 'getPhoneNumber failed', e);
    return null;
  }
}
