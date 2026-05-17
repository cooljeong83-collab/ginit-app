import { skipToken, useIsRestoring, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useUserSession } from '@/src/context/UserSessionContext';
import { useObserveMeetingDetail } from '@/src/hooks/use-observe-meeting-detail';
import { purgeDeletedMeetingLocally } from '@/src/lib/meeting-deleted-local-purge';
import { meetingDetailQueryKey } from '@/src/lib/meeting-detail-query-keys';
import { upsertMeetingDetailToWatermelon } from '@/src/lib/meeting-detail-watermelon-cache';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingById } from '@/src/lib/meetings';

export { meetingDetailQueryKey };

const STALE_MS = 1000 * 60 * 5;
const GC_MS = 24 * 60 * 60 * 1000;

async function fetchMeetingDetailAndPersist(
  meetingId: string,
  queryClient: QueryClient,
  viewerUserId?: string | null,
): Promise<Meeting | null> {
  const m = await getMeetingById(meetingId);
  if (m === null) {
    await purgeDeletedMeetingLocally(queryClient, meetingId, viewerUserId);
  } else {
    await upsertMeetingDetailToWatermelon(meetingId, m);
    queryClient.setQueryData(meetingDetailQueryKey(meetingId), m);
  }
  return m;
}

export type UseMeetingDetailQueryOptions = {
  /** 채팅 등 — 로컬 캐시 즉시 표시 후에도 마운트마다 서버 revalidate */
  refetchOnMount?: boolean | 'always';
};

/**
 * 모임 상세: 진입 시 TanStack Query Fetch → Watermelon upsert(Stale-While-Revalidate).
 * 네이티브 UI는 `useObserveMeetingDetail` 스냅샷을 렌더 소스로 사용합니다(Realtime 없음).
 */
export function useMeetingDetailQuery(meetingId: string, opts?: UseMeetingDetailQueryOptions) {
  const queryClient = useQueryClient();
  const { userId } = useUserSession();
  const id = typeof meetingId === 'string' ? meetingId.trim() : '';
  const isRestoring = useIsRestoring();
  const cacheLogIdRef = useRef<string | null>(null);
  const { meeting: localMeeting, hasLocalRow } = useObserveMeetingDetail(id);
  const useWatermelonUi = Platform.OS !== 'web';

  const query = useQuery({
    queryKey: id ? meetingDetailQueryKey(id) : meetingDetailQueryKey('__none'),
    queryFn:
      id.length > 0
        ? () => fetchMeetingDetailAndPersist(id, queryClient, userId?.trim() ?? null)
        : skipToken,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    enabled: id.length > 0,
    refetchOnMount: opts?.refetchOnMount,
  });

  useEffect(() => {
    cacheLogIdRef.current = null;
  }, [id]);

  useEffect(() => {
    if (isRestoring || !id) return;
    if (cacheLogIdRef.current === id) return;
    const cached = queryClient.getQueryData<Meeting | null>(meetingDetailQueryKey(id));
    if (cached === null) {
      cacheLogIdRef.current = id;
      if (useWatermelonUi) {
        void upsertMeetingDetailToWatermelon(id, null);
      }
      return;
    }
    if (cached !== undefined && cached !== null) {
      if (__DEV__) console.log('📦 모임 상세 캐시 로드: ' + id);
      cacheLogIdRef.current = id;
      if (useWatermelonUi) {
        void upsertMeetingDetailToWatermelon(id, cached);
      }
    }
  }, [id, isRestoring, queryClient, useWatermelonUi]);

  const wmHydrating = useWatermelonUi && localMeeting === undefined;

  const queryErrorMsg =
    query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null;

  const loadError = queryErrorMsg;

  const hasFetched = query.data !== undefined || query.isError;
  const serverSaysMissing = hasFetched && query.data === null && !query.isError;

  useEffect(() => {
    if (!id || !serverSaysMissing) return;
    void purgeDeletedMeetingLocally(queryClient, id, userId?.trim() ?? null);
  }, [id, queryClient, serverSaysMissing, userId]);

  const meeting: Meeting | null = serverSaysMissing
    ? null
    : useWatermelonUi
      ? (localMeeting ?? null)
      : query.data !== undefined
        ? query.data
        : null;

  const loading =
    Boolean(id) &&
    loadError == null &&
    !serverSaysMissing &&
    (wmHydrating || (!hasLocalRow && !hasFetched)) &&
    (query.status === 'pending' || query.fetchStatus === 'fetching' || wmHydrating);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  /** 네이티브: Watermelon observe 첫 emit 완료. 웹: TanStack 첫 fetch 완료 */
  const meetingReady = useWatermelonUi ? localMeeting !== undefined : hasFetched;

  return {
    meeting,
    loading,
    loadError,
    refetch,
    meetingReady,
    hasLocalRow,
  };
}
