import * as Linking from 'expo-linking';
import { Alert, Platform } from 'react-native';
import * as Location from 'expo-location';

let didPromptSettingsOnce = false;

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

