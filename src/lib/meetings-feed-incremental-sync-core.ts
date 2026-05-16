import type { QueryClient } from '@tanstack/react-query';

import {
  canRunMeetingsIncrementalSyncAfterGap,
  hydrateMeetingsIncrementalSyncAtFromStorage,
  markMeetingsIncrementalSyncSuccess,
} from '@/src/lib/meetings-incremental-sync-at';
import { performMeetingsQuerySurgicalSync } from '@/src/lib/meeting-sync-service';

type PublicOutcome = 'updated' | 'unchanged' | 'refetched' | 'failed';

/**
 * 공개 피드 캐시 — RPC 증분 → 상세 fetch → 무한 스크롤 `setQueryData` 부분 패치 (refetch 없음 원칙, 캐시 비었을 때만 refetch).
 */
export async function applyPublicMeetingsFeedSummarySync(queryClient: QueryClient): Promise<PublicOutcome> {
  const r = await performMeetingsQuerySurgicalSync(queryClient, null, {
    scope: 'public',
    refetchWhenPublicCacheEmpty: true,
  });
  if (r.status === 'failed') return 'failed';
  if (r.status === 'skipped') return 'unchanged';
  if (r.publicRefetchedEmpty) return 'refetched';
  return r.patchedAny ? 'updated' : 'unchanged';
}

type MyOutcome = 'updated' | 'unchanged' | 'skipped' | 'failed';

/** 내 모임 탭 캐시 — 동일 증분·부분 패치 경로 */
export async function applyMyMeetingsFeedSummarySync(queryClient: QueryClient, rawUserId: string): Promise<MyOutcome> {
  const r = await performMeetingsQuerySurgicalSync(queryClient, rawUserId, {
    scope: 'my',
    refetchWhenPublicCacheEmpty: false,
  });
  if (r.status === 'failed') return 'failed';
  if (r.status === 'skipped') return 'skipped';
  return r.patchedAny ? 'updated' : 'unchanged';
}

const FOREGROUND_INCREMENTAL_MIN_GAP_MS = 2 * 60 * 1000;

/**
 * 공개 피드 + (로그인 시) 내 모임 캐시를 한 번에 증분 동기화합니다.
 * 실패 시 캐시 미변경 — 성공 시에만 마지막 성공 시각(스로틀용)을 갱신합니다.
 */
export async function runMeetingsListIncrementalReconcile(
  queryClient: QueryClient,
  viewerAppUserId: string | null | undefined,
): Promise<'ok' | 'failed'> {
  const r = await performMeetingsQuerySurgicalSync(queryClient, viewerAppUserId, {
    scope: 'both',
    refetchWhenPublicCacheEmpty: true,
  });
  if (r.status === 'failed') return 'failed';
  if (r.status === 'skipped') return 'ok';

  await markMeetingsIncrementalSyncSuccess();
  return 'ok';
}

/**
 * 포그라운드 복귀용: 2분 스로틀 후 `runMeetingsListIncrementalReconcile` 1회.
 */
export async function runMeetingsForegroundIncrementalSync(
  queryClient: QueryClient,
  viewerAppUserId: string | null | undefined,
): Promise<void> {
  await hydrateMeetingsIncrementalSyncAtFromStorage();
  if (!(await canRunMeetingsIncrementalSyncAfterGap(FOREGROUND_INCREMENTAL_MIN_GAP_MS))) return;

  await runMeetingsListIncrementalReconcile(queryClient, viewerAppUserId);
}
