import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import {
  refreshShareShortcutsFromWatermelonNow,
  subscribeShareShortcutsFromWatermelon,
} from '@/src/lib/share-shortcuts-from-watermelon';

/**
 * Android: WatermelonDB 최근 채팅방 기준 Direct Share 동적 숏컷 동기화.
 */
export function ShareShortcutsWatermelonBootstrap() {
  const { userId, isHydrated } = useUserSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    if (!isHydrated) return undefined;
    const uid = userId?.trim() ?? '';
    return subscribeShareShortcutsFromWatermelon({
      queryClient,
      userId: uid,
      enabled: Boolean(uid),
    });
  }, [isHydrated, userId, queryClient]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isHydrated) return undefined;
    const uid = userId?.trim() ?? '';
    if (!uid) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshShareShortcutsFromWatermelonNow(queryClient, uid);
    });
    return () => sub.remove();
  }, [isHydrated, userId, queryClient]);

  return null;
}
