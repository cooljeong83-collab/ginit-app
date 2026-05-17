import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useLayoutEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

import { pushAndroidTabHomeHardwareExitSuppress } from '@/src/lib/android-tab-home-hardware-exit-suppress';

/**
 * Android: 루트 스택 오버레이(채팅방·모임 상세 등) 위에서도 `(tabs)/index` 이중 탭 종료
 * `BackHandler`가 살아 있는 기기 대응 — suppress + 포커스 시 뒤로가기 소비.
 */
export function useAndroidOverlayHardwareBack(
  onHardwareBack: () => void,
  enabled = true,
): void {
  useLayoutEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    return pushAndroidTabHomeHardwareExitSuppress();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || !enabled) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onHardwareBack();
        return true;
      });
      return () => sub.remove();
    }, [enabled, onHardwareBack]),
  );
}
