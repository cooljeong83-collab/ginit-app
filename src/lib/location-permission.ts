import * as Linking from 'expo-linking';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';

let didPromptSettingsOnce = false;

async function ensureAndroidForegroundLocationPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  const coarse = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

  const fineGranted = await PermissionsAndroid.check(fine).catch(() => false);
  const coarseGranted = await PermissionsAndroid.check(coarse).catch(() => false);
  if (fineGranted || coarseGranted) return { granted: true, canAskAgain: true };

  const result = await PermissionsAndroid.requestMultiple([fine, coarse]).catch(() => null);
  const fineResult = result?.[fine];
  const coarseResult = result?.[coarse];
  const granted =
    fineResult === PermissionsAndroid.RESULTS.GRANTED ||
    coarseResult === PermissionsAndroid.RESULTS.GRANTED;
  if (granted) return { granted: true, canAskAgain: true };

  const blocked =
    fineResult === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
    coarseResult === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
  return { granted: false, canAskAgain: !blocked };
}

export async function ensureForegroundLocationPermissionWithSettingsFallback(opts?: {
  /** 설정 유도 Alert를 1회만 띄울지 */
  promptOnce?: boolean;
  /** Alert 제목 */
  title?: string;
  /** Alert 본문 */
  message?: string;
}): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false };

  const title = opts?.title ?? '위치 권한이 필요해요';
  const message =
    opts?.message ??
    '내 주변 모임과 거리 정보를 보여주려면 위치 권한이 필요합니다.\n\n설정에서 위치 권한을 허용해 주세요.';
  const promptOnce = opts?.promptOnce !== false;

  if (Platform.OS === 'android') {
    const androidPerm = await ensureAndroidForegroundLocationPermission();
    if (androidPerm.granted) return androidPerm;
    if (!androidPerm.canAskAgain && (!promptOnce || !didPromptSettingsOnce)) {
      didPromptSettingsOnce = true;
      Alert.alert(title, message, [
        { text: '닫기', style: 'cancel' },
        { text: '설정 열기', onPress: () => void Linking.openSettings() },
      ]);
    }
    return androidPerm;
  }

  const current = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (current?.status === 'granted') return { granted: true, canAskAgain: true };
  const req = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (req?.status === 'granted') return { granted: true, canAskAgain: true };

  const canAskAgain = Boolean(req?.canAskAgain ?? current?.canAskAgain ?? false);
  if (!canAskAgain) {
    if (!promptOnce || !didPromptSettingsOnce) {
      didPromptSettingsOnce = true;
      Alert.alert(title, message, [
        { text: '닫기', style: 'cancel' },
        { text: '설정 열기', onPress: () => void Linking.openSettings() },
      ]);
    }
  }

  return { granted: false, canAskAgain };
}

