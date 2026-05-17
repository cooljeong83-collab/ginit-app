import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

type GinitProcessExitModule = {
  hardExit: () => void;
};

const Native =
  Platform.OS === 'android'
    ? requireNativeModule<GinitProcessExitModule>('GinitProcessExit')
    : null;

/** Activity 종료 + 프로세스 kill — warm start 시 QueryClient 싱글톤·JS 힙을 비웁니다. */
export function hardExitAndroidProcess(): void {
  Native?.hardExit();
}
