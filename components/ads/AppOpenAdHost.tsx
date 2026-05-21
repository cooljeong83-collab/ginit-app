import { useEffect } from 'react';
import { Platform } from 'react-native';

import { subscribeAppOpenAdOnForeground } from '@/src/lib/ads/app-open-ad-service';

/** 백그라운드 복귀 시 앱 오프닝 광고 (쿨다운은 서비스 내부). */
export function AppOpenAdHost() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    return subscribeAppOpenAdOnForeground();
  }, []);

  return null;
}
