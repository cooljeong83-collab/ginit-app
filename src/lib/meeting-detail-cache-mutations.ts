import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { meetingDetailQueryKey } from '@/src/lib/meeting-detail-query-keys';
import { isMeetingNotFoundError, purgeDeletedMeetingLocally } from '@/src/lib/meeting-deleted-local-purge';
import {
  flattenMeetingsFeedInfiniteData,
  type MeetingsFeedPageSlice,
} from '@/src/lib/meetings-feed-page-utils';
import { meetingsFeedInfiniteQueryKey, myMeetingsFeedQueryKey } from '@/src/lib/meetings-query-keys';
import {
  patchMeetingDetailInWatermelon,
  restoreMeetingDetailInWatermelon,
  upsertMeetingDetailToWatermelon,
} from '@/src/lib/meeting-detail-watermelon-cache';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById } from '@/src/lib/meetings';

/** 목록·상세 동기화 비교용 — 참여자 PK 정렬 + updatedAt */
export function meetingParticipantListCacheSignature(m: Meeting): string {
  const ids = (m.participantIds ?? [])
    .map((x) => normalizeParticipantId(String(x)) || String(x).trim())
    .filter(Boolean)
    .sort()
    .join('|');
  let updated = 0;
  try {
    updated = m.updatedAt?.toMillis?.() ?? 0;
  } catch {
    updated = 0;
  }
  return `${updated}\u0000${ids}`;
}

/** my-feed·공개 feed infinite 캐시에서 모임 1건 조회 */
export function findMeetingInMeetingsListCaches(
  queryClient: QueryClient,
  meetingId: string,
  viewerUserId?: string | null,
): Meeting | null {
  const mid = meetingId.trim();
  if (!mid) return null;
  const uid = normalizeParticipantId(viewerUserId ?? '');
  if (uid) {
    const myMeetings =
      queryClient.getQueryData<{ meetings: Meeting[] }>(myMeetingsFeedQueryKey(uid))?.meetings ?? [];
    const fromMy = myMeetings.find((m) => (typeof m.id === 'string' ? m.id.trim() : '') === mid);
    if (fromMy) return fromMy;
  }
  const fromFeed = flattenMeetingsFeedInfiniteData(
    queryClient.getQueryData<InfiniteData<MeetingsFeedPageSlice>>(meetingsFeedInfiniteQueryKey()),
  );
  return fromFeed.find((m) => (typeof m.id === 'string' ? m.id.trim() : '') === mid) ?? null;
}

/**
 * 모임 목록 증분 동기화로 받은 스냅샷을, 이미 로드된 모임 상세 캐시·Watermelon에 반영합니다.
 * (추가 네트워크 없음 — `performMeetingsQuerySurgicalSync`의 `fetchMeetingsForSyncByIds` 결과 재사용)
 */
/** 목록 스냅샷 1건을 상세 Watermelon(+ TanStack 캐시가 있으면 함께)에 반영 */
export async function applyMeetingDetailSnapshotFromListUpdate(
  queryClient: QueryClient,
  snapshot: Meeting,
): Promise<void> {
  const mid = typeof snapshot.id === 'string' ? snapshot.id.trim() : '';
  if (!mid) return;
  await upsertMeetingDetailToWatermelon(mid, snapshot);
  const key = meetingDetailQueryKey(mid);
  if (queryClient.getQueryData<Meeting | null>(key) !== undefined) {
    queryClient.setQueryData(key, snapshot);
  }
}

/**
 * 모임 목록 증분 동기화로 받은 스냅샷을, 이미 로드된 모임 상세 캐시·Watermelon에 반영합니다.
 * (추가 네트워크 없음 — `performMeetingsQuerySurgicalSync`의 `fetchMeetingsForSyncByIds` 결과 재사용)
 */
export async function syncMeetingDetailCachesFromMeetingsListUpdates(
  queryClient: QueryClient,
  updates: readonly Meeting[],
): Promise<number> {
  let patched = 0;
  for (const m of updates) {
    const mid = typeof m.id === 'string' ? m.id.trim() : '';
    if (!mid) continue;
    const key = meetingDetailQueryKey(mid);
    if (queryClient.getQueryData<Meeting | null>(key) === undefined) continue;
    await applyMeetingDetailSnapshotFromListUpdate(queryClient, m);
    patched += 1;
  }
  return patched;
}

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
