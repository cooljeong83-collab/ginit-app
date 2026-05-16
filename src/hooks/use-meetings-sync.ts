import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { performMeetingsQuerySurgicalSync } from '@/src/lib/meeting-sync-service';

export type UseMeetingsSyncOptions = {
  enabled?: boolean;
  /** 로그인 사용자 id — 내 모임 캐시 동기화에 사용 */
  userId?: string | null;
};

/**
 * 공개 피드 + 내 모임 TanStack 캐시를 **refetch 없이** RPC 증분 → 상세 fetch → `setQueryData` 패치로 맞춥니다.
 * `last_sync_at`은 AsyncStorage(`meetings-sync-last-at-storage`)에 저장됩니다.
 */
export function useMeetingsSync(options?: UseMeetingsSyncOptions) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;
  const userId = options?.userId ?? null;
  const [isSyncing, setIsSyncing] = useState(false);

  const syncMeetingsNow = useCallback(async () => {
    if (!enabled) return { status: 'skipped' as const };
    setIsSyncing(true);
    try {
      return await performMeetingsQuerySurgicalSync(queryClient, userId, {
        scope: 'both',
        refetchWhenPublicCacheEmpty: false,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [enabled, queryClient, userId]);

  return { syncMeetingsNow, isSyncing };
}
