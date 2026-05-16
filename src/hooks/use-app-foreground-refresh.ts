import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { runMeetingsUserActionDeltaSync } from '@/src/lib/meeting-sync-service';

/**
 * 앱이 비-active → active 로 전환될 때(및 웹에서는 탭이 다시 보일 때),
 * 전체 refetch 대신 **델타 동기화**(변경 id만 RPC) 1회 실행합니다.
 */
export function useAppForegroundMeetingsRefresh() {
  const queryClient = useQueryClient();
  const { userId } = useUserSession();
  const prevStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisibility = () => {
        if (document.visibilityState !== 'visible') return;
        void runMeetingsUserActionDeltaSync(queryClient, userId?.trim() ?? null, 'foreground');
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => document.removeEventListener('visibilitychange', onVisibility);
    }

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = prevStateRef.current;
      prevStateRef.current = next;

      if (next !== 'active' || prev === 'active') return;

      void runMeetingsUserActionDeltaSync(queryClient, userId?.trim() ?? null, 'foreground');
    });

    return () => {
      sub.remove();
    };
  }, [queryClient, userId]);
}

/** `UserSessionProvider` + `QueryClientPersistProvider` 하위에서만 마운트하세요. */
export function AppForegroundMeetingsRefreshHost() {
  useAppForegroundMeetingsRefresh();
  return null;
}
