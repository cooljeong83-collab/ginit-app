import type { QueryClient } from '@tanstack/react-query';

import { wipeLocalAppToFreshInstallState } from '@/src/lib/local-app-fresh-install-wipe';

export type PurgeSignOutSessionCachesOptions = {
  /** @deprecated AsyncStorage.clear()로 전체 삭제 */
  outgoingAppUserId?: string | null;
  /** Android 프로세스 kill 직전 — Watermelon 파일 삭제를 다음 콜드 스타트로 미룸 */
  deferWatermelonToNextLaunch?: boolean;
};

let purgeSignOutInFlight: Promise<void> | null = null;

async function runPurgeSignOutSessionCaches(
  queryClient: QueryClient,
  opts?: PurgeSignOutSessionCachesOptions,
): Promise<void> {
  await wipeLocalAppToFreshInstallState({
    queryClient,
    deferWatermelonToNextLaunch: opts?.deferWatermelonToNextLaunch,
  });
}

/** 로그아웃·세션 만료 — 로컬을 최초 설치 직후 상태에 가깝게 비웁니다. */
export async function purgeSignOutSessionCaches(
  queryClient: QueryClient,
  opts?: PurgeSignOutSessionCachesOptions,
): Promise<void> {
  if (purgeSignOutInFlight) {
    await purgeSignOutInFlight;
    return;
  }
  purgeSignOutInFlight = runPurgeSignOutSessionCaches(queryClient, opts).finally(() => {
    purgeSignOutInFlight = null;
  });
  await purgeSignOutInFlight;
}

/** @deprecated `purgeSignOutSessionCaches` 사용 */
export async function resetMeetingsSessionCaches(queryClient: QueryClient): Promise<void> {
  await purgeSignOutSessionCaches(queryClient);
}
