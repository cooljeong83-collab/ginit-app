import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { resetChatRoomsEmptyRecoveryState } from '@/src/lib/chat-rooms-empty-recovery-state';
import { resetMeetingsFeedDeferredSyncState } from '@/src/lib/meetings-feed-deferred-sync';
import { clearPendingPushOpenPayload } from '@/src/lib/pending-push-navigation';
import { markWatermelonDatabaseDeletionOnNextLaunch } from '@/src/lib/watermelon-db-files';
import { purgeLocalUserScopedWatermelonOnSignOut } from '@/src/lib/watermelon-local-purge';

const WIPE_TOTAL_MS = 8_000;
const WM_PURGE_MS = 5_000;
const ASYNC_STORAGE_CLEAR_MS = 3_000;

export type WipeLocalAppToFreshInstallOptions = {
  queryClient?: QueryClient;
  /**
   * true면 열린 Watermelon 연결에 DELETE를 걸지 않고, 다음 앱 실행 전 SQLite 파일 삭제를 예약합니다.
   * (Android `exitApp` 직전 — DB 락으로 JS가 멈추는 것을 방지)
   */
  deferWatermelonToNextLaunch?: boolean;
};

function withDeadline<T>(label: string, ms: number, op: () => Promise<T>): Promise<T | void> {
  return Promise.race([
    op(),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (__DEV__) console.warn(`[freshInstallWipe] ${label} timeout (${ms}ms)`);
        resolve();
      }, ms),
    ),
  ]);
}

async function runWipe(opts?: WipeLocalAppToFreshInstallOptions): Promise<void> {
  const queryClient = opts?.queryClient;

  clearPendingPushOpenPayload();

  if (queryClient) {
    /** `cancelQueries()`는 abort 미지원 queryFn에서 무한 대기할 수 있어 사용하지 않습니다. */
    queryClient.clear();
  }

  if (opts?.deferWatermelonToNextLaunch) {
    if (__DEV__) console.log('[freshInstallWipe] defer wm → next launch marker');
    await markWatermelonDatabaseDeletionOnNextLaunch();
  } else {
    await withDeadline('wm', WM_PURGE_MS, () => purgeLocalUserScopedWatermelonOnSignOut());
  }

  await withDeadline('AsyncStorage.clear', ASYNC_STORAGE_CLEAR_MS, () => AsyncStorage.clear());

  resetMeetingsFeedDeferredSyncState();
  resetChatRoomsEmptyRecoveryState();
}

/**
 * 로그아웃·탈퇴 후 이 기기의 앱 로컬 상태를 **최초 설치 직후**에 가깝게 만듭니다.
 */
export async function wipeLocalAppToFreshInstallState(
  opts?: WipeLocalAppToFreshInstallOptions,
): Promise<void> {
  if (__DEV__) console.log('[freshInstallWipe] start', { deferWm: Boolean(opts?.deferWatermelonToNextLaunch) });

  await withDeadline('total', WIPE_TOTAL_MS, () => runWipe(opts));

  if (__DEV__) console.log('[freshInstallWipe] done');
}
