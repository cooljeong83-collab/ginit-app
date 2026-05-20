import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { recordAppActiveUser } from '@/src/features/analytics/record-app-active-user';

/**
 * 로그인된 사용자가 앱을 켜거나 포그라운드로 돌아올 때 DAU 집계(일 1회).
 */
export function useRecordAppActiveUser(appUserId: string | null | undefined): void {
  useEffect(() => {
    const id = appUserId?.trim();
    if (!id) return;

    const onActive = () => {
      void recordAppActiveUser(id);
    };

    onActive();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') onActive();
    });

    return () => sub.remove();
  }, [appUserId]);
}
