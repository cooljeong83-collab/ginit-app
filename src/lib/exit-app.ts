import { hardExitAndroidProcess } from 'ginit-process-exit';
import { BackHandler, Platform } from 'react-native';

/**
 * 로그아웃 후 재진입 시 in-memory QueryClient·persist 잔존을 막기 위해 Android는 프로세스를 kill합니다.
 * `purgeSignOutSessionCaches` 직후 호출하세요.
 */
export async function requestAppExit(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    hardExitAndroidProcess();
    return;
  }
  BackHandler.exitApp();
}
