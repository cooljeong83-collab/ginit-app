import { DeviceEventEmitter } from 'react-native';

/** `useSplashBootstrap` → `router.replace('/(tabs)')` 직후. `pathname`이 `/`에 남는 기기에서도 pending 푸시 소비용. */
export const GINIT_SPLASH_REPLACED_TO_TABS = 'ginit_splash_replaced_to_tabs_v1';

export function notifySplashReplacedToTabs(): void {
  DeviceEventEmitter.emit(GINIT_SPLASH_REPLACED_TO_TABS);
}
