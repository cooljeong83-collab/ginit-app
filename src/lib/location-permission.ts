import * as Linking from 'expo-linking';
import { PermissionsAndroid, Platform } from 'react-native';
import { presentAppDialogAlert, presentAppDialogConfirm } from '@/src/lib/app-dialog-present';
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
      presentAppDialogConfirm({
        title,
        body: message,
        cancelLabel: '닫기',
        confirmLabel: '설정 열기',
        onConfirm: () => void Linking.openSettings(),
      });
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
      presentAppDialogConfirm({
        title,
        body: message,
        cancelLabel: '닫기',
        confirmLabel: '설정 열기',
        onConfirm: () => void Linking.openSettings(),
      });
    }
  }

  return { granted: false, canAskAgain };
}

/** 탐색(지도) «내 위치»·거리순 정렬 등에서 동일하게 쓰는 권한 안내 문구 */
export function foregroundLocationPermissionAlertContent(): {
  title: string;
  settingsMessage: string;
  deniedCanAskAgainMessage: string;
} {
  return {
    title: '위치 권한이 필요해요',
    settingsMessage:
      Platform.OS === 'ios'
        ? '내 위치로 이동하려면 위치 권한이 필요합니다.\n\n설정 앱 → 개인정보 보호 및 보안 → 위치 서비스 → 지닛에서 «위치»를 «앱을 사용하는 동안» 또는 «항상»으로 바꿔 주세요.'
        : '내 위치로 이동하려면 위치 권한이 필요합니다.\n\n설정 → 앱 → 지닛 → 권한 → 위치에서 «앱 사용 중에만 허용» 또는 «항상 허용»으로 바꿔 주세요.',
    deniedCanAskAgainMessage: '내 위치로 이동하려면 위치 권한을 허용해 주세요.',
  };
}

/** 지도 «내 위치» 버튼과 동일한 권한 요청(설정 유도 Alert 포함). */
export async function ensureForegroundLocationPermissionLikeMyLocation(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  const { title, settingsMessage } = foregroundLocationPermissionAlertContent();
  return ensureForegroundLocationPermissionWithSettingsFallback({
    promptOnce: false,
    title,
    message: settingsMessage,
  });
}

/** 권한 거부 후 «내 위치»와 동일한 안내 Alert (`canAskAgain`일 때만). */
export function alertForegroundLocationPermissionDeniedLikeMyLocation(canAskAgain: boolean): void {
  if (Platform.OS === 'web') {
    presentAppDialogAlert({ title: '위치 권한', body: '웹에서는 내 위치 이동을 지원하지 않습니다.' });
    return;
  }
  if (canAskAgain) {
    const { title, deniedCanAskAgainMessage } = foregroundLocationPermissionAlertContent();
    presentAppDialogAlert({ title, body: deniedCanAskAgainMessage });
  }
}

