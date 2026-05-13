import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { meetingListSource } from '@/src/lib/hybrid-data-source';
import type { Meeting } from '@/src/lib/meetings';
import {
  canRunMeetingsIncrementalSyncAfterGap,
  hydrateMeetingsIncrementalSyncAtFromStorage,
  markMeetingsIncrementalSyncSuccess,
} from '@/src/lib/meetings-incremental-sync-at';
import {
  diffMeetingSummaries,
  fetchMeetingsForSyncByIds,
  fetchPublicMeetingChangeSummaries,
  mergeMeetingsBySummaries,
  PUBLIC_MEETINGS_PAGE_SIZE,
  syncMyMeetingsFromSummaries,
} from '@/src/lib/supabase-meetings-list';

type Page = { meetings: Meeting[]; hasMore: boolean };
type FeedInfiniteData = InfiniteData<Page, number>;

function publicFeedQueryKey() {
  return ['meetings', 'feed', meetingListSource()] as const;
}

function myMeetingsFeedQueryKey(appUserId: string) {
  return ['meetings', 'my-feed', meetingListSource(), normalizeParticipantId(appUserId)] as const;
}

function flattenPages(data: FeedInfiniteData | undefined): Meeting[] {
  const pages = data?.pages ?? [];
  const seen = new Set<string>();
  const out: Meeting[] = [];
  for (const p of pages) {
    for (const m of p.meetings) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

function buildPagesFromMeetings(meetings: readonly Meeting[], pageCount: number, remoteSummaryCount: number): Page[] {
  const count = Math.max(1, pageCount);
  return Array.from({ length: count }, (_, idx) => {
    const from = idx * PUBLIC_MEETINGS_PAGE_SIZE;
    const slice = meetings.slice(from, from + PUBLIC_MEETINGS_PAGE_SIZE);
    return {
      meetings: slice,
      hasMore: remoteSummaryCount > from + slice.length,
    };
  }).filter((page, idx) => idx === 0 || page.meetings.length > 0);
}

type PublicOutcome = 'updated' | 'unchanged' | 'refetched' | 'failed';

/**
 * 공개 피드: 요약 RPC → 변경 ID만 상세 fetch → 캐시 병합 (또는 Firestore/빈 캐시 시 refetch).
 * RPC 실패 시 캐시는 그대로 두고 `failed` 반환.
 */
export async function applyPublicMeetingsFeedSummarySync(queryClient: QueryClient): Promise<PublicOutcome> {
  const queryKey = publicFeedQueryKey();

  if (meetingListSource() !== 'supabase') {
    try {
      await queryClient.refetchQueries({ queryKey });
      return 'refetched';
    } catch {
      return 'failed';
    }
  }

  const current = queryClient.getQueryData<FeedInfiniteData>(queryKey);
  const cachedMeetings = flattenPages(current);
  if (cachedMeetings.length === 0) {
    try {
      await queryClient.refetchQueries({ queryKey });
      return 'refetched';
    } catch {
      return 'failed';
    }
  }

  const summaryLimit = Math.min(400, Math.max(PUBLIC_MEETINGS_PAGE_SIZE, cachedMeetings.length + PUBLIC_MEETINGS_PAGE_SIZE));
  const summariesRes = await fetchPublicMeetingChangeSummaries(summaryLimit);
  if (!summariesRes.ok) return 'failed';

  const summaries = summariesRes.summaries;
  const relevantSummaries = summaries.slice(0, summaryLimit);
  const { changedIds, deletedIds } = diffMeetingSummaries(cachedMeetings, relevantSummaries);
  if (changedIds.length === 0 && deletedIds.length === 0) return 'unchanged';

  const changedRes = await fetchMeetingsForSyncByIds(changedIds);
  if (!changedRes.ok) return 'failed';

  const nextMeetings = mergeMeetingsBySummaries(cachedMeetings, relevantSummaries, changedRes.meetings).slice(
    0,
    Math.max(cachedMeetings.length, PUBLIC_MEETINGS_PAGE_SIZE),
  );

  queryClient.setQueryData<FeedInfiniteData>(queryKey, (prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      pages: buildPagesFromMeetings(nextMeetings, prev.pages.length, summaries.length),
    };
  });
  return 'updated';
}

type MyOutcome = 'updated' | 'unchanged' | 'skipped' | 'failed';

/** 내 모임 탭 캐시 — `syncMyMeetingsFromSummaries` 경로 */
export async function applyMyMeetingsFeedSummarySync(queryClient: QueryClient, rawUserId: string): Promise<MyOutcome> {
  const uid = normalizeParticipantId(rawUserId);
  if (!uid || meetingListSource() !== 'supabase') return 'skipped';

  const queryKey = myMeetingsFeedQueryKey(uid);
  const current = queryClient.getQueryData<{ meetings: Meeting[] }>(queryKey);
  const cachedMeetings = current?.meetings ?? [];

  const res = await syncMyMeetingsFromSummaries(cachedMeetings, uid);
  if (!res.ok) return 'failed';
  if (!res.changed) return 'unchanged';
  queryClient.setQueryData(queryKey, { meetings: res.meetings });
  return 'updated';
}

const FOREGROUND_INCREMENTAL_MIN_GAP_MS = 2 * 60 * 1000;

/**
 * 스로틀 없이 공개 피드 + (로그인 시) 내 모임 탭 캐시를 증분 동기화합니다.
 * 둘 중 하나라도 `failed`면 캐시를 건드리지 않고 `failed` — 성공 시에만 마지막 성공 시각을 갱신합니다.
 * (인앱 알람 후 홈 목록 정합성, 포그라운드 복귀 등에서 공유)
 */
export async function runMeetingsListIncrementalReconcile(
  queryClient: QueryClient,
  viewerAppUserId: string | null | undefined,
): Promise<'ok' | 'failed'> {
  const pub = await applyPublicMeetingsFeedSummarySync(queryClient);
  if (pub === 'failed') return 'failed';

  const uid = viewerAppUserId?.trim() ?? '';
  const my = uid ? await applyMyMeetingsFeedSummarySync(queryClient, uid) : ('skipped' as const);
  if (my === 'failed') return 'failed';

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
