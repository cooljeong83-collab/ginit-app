import type { QueryClient } from '@tanstack/react-query';

import { meetingDetailQueryKey } from '@/src/lib/meeting-detail-query-keys';
import { isMeetingNotFoundError, purgeDeletedMeetingLocally } from '@/src/lib/meeting-deleted-local-purge';
import {
  patchMeetingDetailInWatermelon,
  restoreMeetingDetailInWatermelon,
  upsertMeetingDetailToWatermelon,
} from '@/src/lib/meeting-detail-watermelon-cache';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById } from '@/src/lib/meetings';

/** 서버에서 최신 스냅샷을 가져와 Watermelon + TanStack 캐시를 함께 갱신합니다. */
export async function refreshMeetingDetailCaches(
  queryClient: QueryClient,
  meetingId: string,
): Promise<Meeting | null> {
  const mid = meetingId.trim();
  if (!mid) return null;
  const m = await getMeetingById(mid);
  if (m === null) {
    await purgeDeletedMeetingLocally(queryClient, mid);
    return null;
  }
  await upsertMeetingDetailToWatermelon(mid, m);
  queryClient.setQueryData(meetingDetailQueryKey(mid), m);
  return m;
}

/** 낙관적 패치 후 서버 작업 — 실패 시 로컬 롤백. */
export async function withMeetingDetailOptimistic<T>(
  meetingId: string,
  apply: (prev: Meeting) => Meeting,
  serverOp: () => Promise<T>,
  opts?: { queryClient?: QueryClient; onSuccessRefresh?: boolean },
): Promise<T> {
  const mid = meetingId.trim();
  const { previous } = await patchMeetingDetailInWatermelon(mid, apply);
  try {
    const result = await serverOp();
    if (opts?.onSuccessRefresh !== false && opts?.queryClient) {
      void refreshMeetingDetailCaches(opts.queryClient, mid);
    }
    return result;
  } catch (e) {
    if (isMeetingNotFoundError(e) && opts?.queryClient) {
      await purgeDeletedMeetingLocally(opts.queryClient, mid);
    } else {
      await restoreMeetingDetailInWatermelon(mid, previous);
    }
    throw e;
  }
}

/** TanStack `setQueryData` 대신 Watermelon만 즉시 패치(UI는 observe가 반영). */
export async function patchMeetingDetailLocal(
  meetingId: string,
  updater: (prev: Meeting) => Meeting,
): Promise<void> {
  await patchMeetingDetailInWatermelon(meetingId, updater);
}
