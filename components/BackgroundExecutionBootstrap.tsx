import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerGinitBackgroundFetchAsync } from '@/src/lib/ginit-background-fetch';

/**
 * 네이티브에서 백그라운드 주기 실행(Background Fetch)을 등록합니다.
 * `ginit-background-fetch` 모듈의 `TaskManager.defineTask`는 번들 로드 시 평가되도록 `_layout`에서 먼저 import 됩니다.
 */
export function BackgroundExecutionBootstrap() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void registerGinitBackgroundFetchAsync().catch(() => {});
  }, []);
  return null;
}
