import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { meetingListSource } from '@/src/lib/hybrid-data-source';
import { recordMeetingsListPageFetchedFromNetwork } from '@/src/lib/meetings-feed-deferred-sync';
import type { Meeting } from '@/src/lib/meetings';
import {
  fetchMyMeetingsForFeedFromSupabase,
} from '@/src/lib/supabase-meetings-list';
import { applyMyMeetingsFeedSummarySync } from '@/src/lib/meetings-feed-incremental-sync-core';

type MyMeetingsQueryData = {
  meetings: Meeting[];
};

const EMPTY_MEETINGS: Meeting[] = [];

export function myMeetingsFeedQueryKey(appUserId: string) {
  return ['meetings', 'my-feed', meetingListSource(), normalizeParticipantId(appUserId)] as const;
}

async function fetchMyMeetingsFull(appUserId: string): Promise<MyMeetingsQueryData> {
  const res = await fetchMyMeetingsForFeedFromSupabase(appUserId);
  if (!res.ok) throw new Error(res.message);
  recordMeetingsListPageFetchedFromNetwork();
  return { meetings: res.meetings };
}

export function useMyMeetingsFeedSync({
  enabled,
  userId,
}: {
  enabled: boolean;
  userId?: string | null;
}) {
  const normalizedUserId = useMemo(() => normalizeParticipantId(userId ?? ''), [userId]);
  const queryKey = useMemo(() => myMeetingsFeedQueryKey(normalizedUserId), [normalizedUserId]);
  const queryClient = useQueryClient();
  const shouldRun = enabled && Boolean(normalizedUserId) && meetingListSource() === 'supabase';

  const query = useQuery({
    queryKey,
    enabled: shouldRun,
    queryFn: () => fetchMyMeetingsFull(normalizedUserId),
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const clear = useCallback(() => {
    queryClient.setQueryData<MyMeetingsQueryData>(queryKey, { meetings: [] });
  }, [queryClient, queryKey]);

  const syncChangedMeetings = useCallback(async () => {
    if (!shouldRun) {
      clear();
      return;
    }
    await applyMyMeetingsFeedSummarySync(queryClient, normalizedUserId);
  }, [clear, normalizedUserId, queryClient, shouldRun]);

  const refetchFull = useCallback(async () => {
    if (!shouldRun) {
      clear();
      return;
    }
    await query.refetch();
  }, [clear, query, shouldRun]);

  return {
    meetings: shouldRun ? (query.data?.meetings ?? EMPTY_MEETINGS) : EMPTY_MEETINGS,
    isInitialLoading: shouldRun && query.isPending && !query.data,
    syncChangedMeetings,
    refetchFull,
  };
}
