import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { hydrateMeetingsIncrementalSyncAtFromStorage } from '@/src/lib/meetings-incremental-sync-at';
import { runMeetingsForegroundIncrementalSync } from '@/src/lib/meetings-feed-incremental-sync-core';

/**
 * 앱이 비-active → active 로 전환될 때, 2분 스로틀 + AsyncStorage 기준으로
 * 공개/내 모임 목록 **증분 동기화**(요약 → 변경 ID만 fetch)를 1회 실행합니다.
 */
export function useAppForegroundMeetingsRefresh() {
  const queryClient = useQueryClient();
  const { userId } = useUserSession();
  const prevStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    void hydrateMeetingsIncrementalSyncAtFromStorage();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = prevStateRef.current;
      prevStateRef.current = next;

      if (next !== 'active' || prev === 'active') return;

      void runMeetingsForegroundIncrementalSync(queryClient, userId?.trim() ?? null);
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
